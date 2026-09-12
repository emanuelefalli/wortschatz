// Deterministic merge of two backups (spec §12: append-only review history
// makes progress reconstructible). Pure function, no I/O.

import type { Backup } from "../db/repo";
import type { DailyStats, LearningState, ReviewLogEntry, SessionRecord } from "../domain/types";
import { localDay } from "../domain/time";

const later = (a?: string, b?: string) => (a ?? "") >= (b ?? "");

function pickState(a: LearningState, b: LearningState): LearningState {
  if ((a.lastReviewedAt ?? "") !== (b.lastReviewedAt ?? "")) return later(a.lastReviewedAt, b.lastReviewedAt) ? a : b;
  if (a.repetitions !== b.repetitions) return a.repetitions > b.repetitions ? a : b;
  if (a.suspended !== b.suspended) return a.suspended ? a : b;
  return later(a.dueAt, b.dueAt) ? a : b;
}

export const logKey = (e: ReviewLogEntry) => `${e.sessionId}|${e.senseId}|${e.skill}|${e.mode}|${e.reviewedAt}`;

/** Active sessions are device-local and never synced; finished/abandoned ones are history. */
function pickSession(local: SessionRecord | undefined, remote: SessionRecord | undefined): SessionRecord {
  if (!local) return remote!;
  if (!remote) return local;
  return remote.answered.length > local.answered.length ? remote : local;
}

/** Recompute daily counters from the unaided review log (first review of a sense in any direction = new word). */
export function dailyStatsFromLog(log: ReviewLogEntry[]): DailyStats[] {
  const byDay = new Map<string, DailyStats>();
  const seenSense = new Set<string>();
  const unaided = log.filter((e) => e.mode === "unaided").sort((a, b) => (a.reviewedAt < b.reviewedAt ? -1 : 1));
  for (const e of unaided) {
    const day = localDay(new Date(e.reviewedAt));
    const d = byDay.get(day) ?? { day, reviews: 0, newWords: 0, correct: 0, almost: 0, wrong: 0 };
    d.reviews++;
    if (!seenSense.has(e.senseId)) {
      seenSense.add(e.senseId);
      d.newWords++;
    }
    if (e.outcome === "correct") d.correct++;
    else if (e.outcome === "almost") d.almost++;
    else d.wrong++;
    byDay.set(day, d);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Union of two backups. `local` wins ties; output is canonically ordered so equal content serializes identically. */
export function mergeBackups(local: Backup, remote: Backup): Backup {
  const words = new Map(remote.words.map((w) => [w.id, w]));
  for (const w of local.words) words.set(w.id, w);

  const states = new Map(remote.learningStates.map((s) => [s.key, s]));
  for (const s of local.learningStates) {
    const r = states.get(s.key);
    states.set(s.key, r ? pickState(s, r) : s);
  }

  const log = new Map<string, ReviewLogEntry>();
  for (const e of [...remote.reviewLog, ...local.reviewLog]) {
    const { id: _id, ...rest } = e;
    log.set(logKey(e), rest);
  }
  const reviewLog = [...log.values()].sort((a, b) => (a.reviewedAt < b.reviewedAt ? -1 : a.reviewedAt > b.reviewedAt ? 1 : logKey(a).localeCompare(logKey(b))));

  const finishedL = local.sessions.filter((s) => s.status !== "active");
  const finishedR = remote.sessions.filter((s) => s.status !== "active");
  const sessionIds = new Set([...finishedL.map((s) => s.id), ...finishedR.map((s) => s.id)]);
  const localS = new Map(finishedL.map((s) => [s.id, s]));
  const remoteS = new Map(finishedR.map((s) => [s.id, s]));
  const sessions = [...sessionIds].map((id) => pickSession(localS.get(id), remoteS.get(id))).sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));

  const settings = later(local.settings.updatedAt, remote.settings.updatedAt) ? local.settings : remote.settings;

  const reports = new Map<string, Backup["reports"][number]>();
  for (const r of [...remote.reports, ...local.reports]) {
    const { id: _id, ...rest } = r;
    reports.set(`${r.createdAt}|${r.senseId}|${r.kind}`, rest);
  }

  const custom = new Map<string, NonNullable<Backup["customAnswers"]>[number]>();
  for (const c of [...(remote.customAnswers ?? []), ...(local.customAnswers ?? [])]) {
    const { id: _id, ...rest } = c;
    custom.set(`${c.senseId}|${c.skill}|${c.answer.toLocaleLowerCase("de-DE")}`, rest);
  }

  const lists = new Map((remote.lists ?? []).map((l) => [l.id, l]));
  for (const l of local.lists ?? []) {
    const r = lists.get(l.id);
    lists.set(l.id, !r || later(l.updatedAt, r.updatedAt) ? l : r);
  }

  return {
    format: "german-flashcards-backup",
    schemaVersion: Math.max(local.schemaVersion, remote.schemaVersion),
    exportedAt: later(local.exportedAt, remote.exportedAt) ? local.exportedAt : remote.exportedAt,
    words: [...words.values()].sort((a, b) => a.id.localeCompare(b.id)),
    learningStates: [...states.values()].sort((a, b) => a.key.localeCompare(b.key)),
    reviewLog,
    sessions,
    settings,
    dailyStats: dailyStatsFromLog(reviewLog),
    reports: [...reports.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    customAnswers: [...custom.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    lists: [...lists.values()].sort((a, b) => a.id.localeCompare(b.id))
  };
}

/** Content fingerprint that ignores export time, for "nothing changed" checks. */
export function contentSignature(b: Backup): string {
  const { exportedAt: _e, ...rest } = b;
  return JSON.stringify(rest);
}
