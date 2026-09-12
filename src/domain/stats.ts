// Progress aggregation (spec §9). Pure functions.

import type { CefrLevel, LearningState, ReviewLogEntry, Skill, Word } from "./types";
import { isDue, maturity, retrievability, makeScheduler, type MaturityBucket } from "./scheduler";
import { stateKey, PHASE1_SKILLS } from "./types";

export type ErrorCounts = { spelling: number; article: number; capitalization: number; umlaut: number; meaning: number; total: number };

export type Overview = {
  dueNow: number;
  overdueByDay: number;
  buckets: Record<MaturityBucket, number>;
  /** Maturity buckets per CEFR level. */
  bucketsByLevel: Partial<Record<CefrLevel, Record<MaturityBucket, number>>>;
  /** Cards becoming due per local day: index 0 = today (including overdue), 1 = tomorrow, … */
  forecast: number[];
  /** Error types per translation direction. */
  errorsBySkill: Record<"de_en" | "en_de", ErrorCounts>;
  totalCards: number;
  totalSenses: number;
  /** Mean predicted retrievability of cards in review. */
  estimatedRetention: number;
  /** Share of senses with at least one non-new direction. */
  coverage: number;
  accuracyBySkill: Record<Skill, { total: number; correct: number; almost: number }>;
  accuracyByLevel: Record<CefrLevel, { total: number; correct: number }>;
  errorTypes: { spelling: number; article: number; capitalization: number; umlaut: number; meaning: number };
  leeches: { wordId: string; senseId: string; skill: Skill; lapses: number }[];
};

export const FORECAST_DAYS = 7;

const emptyBuckets = (): Record<MaturityBucket, number> => ({ new: 0, learning: 0, mature: 0, suspended: 0 });
const emptyErrors = (): ErrorCounts => ({ spelling: 0, article: 0, capitalization: 0, umlaut: 0, meaning: 0, total: 0 });

/** Whole local days between now and a due timestamp (0 = today or overdue). */
function dayOffset(dueAt: string, now: Date): number {
  const due = new Date(dueAt);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  return Math.max(0, Math.round((startOfDue.getTime() - startOfToday.getTime()) / 86400000));
}

export function computeOverview(
  words: Word[],
  states: Map<string, LearningState>,
  log: ReviewLogEntry[],
  now: Date
): Overview {
  const scheduler = makeScheduler();
  const buckets = emptyBuckets();
  const bucketsByLevel: Overview["bucketsByLevel"] = {};
  const forecast = new Array<number>(FORECAST_DAYS).fill(0);
  const errorsBySkill: Overview["errorsBySkill"] = { de_en: emptyErrors(), en_de: emptyErrors() };
  let dueNow = 0;
  let overdueByDay = 0;
  let retSum = 0;
  let retCount = 0;
  let totalCards = 0;
  let totalSenses = 0;
  let coveredSenses = 0;
  const leeches: Overview["leeches"] = [];
  const levelBySense = new Map<string, CefrLevel>();

  for (const w of words) {
    for (const s of w.senses) {
      totalSenses++;
      levelBySense.set(s.id, w.cefrLevel);
      let covered = false;
      for (const skill of PHASE1_SKILLS) {
        totalCards++;
        const st = states.get(stateKey(s.id, skill));
        const b = st ? maturity(st) : "new";
        buckets[b]++;
        (bucketsByLevel[w.cefrLevel] ??= emptyBuckets())[b]++;
        if (st) {
          if (b !== "new") covered = true;
          if (!st.suspended && st.repetitions > 0) {
            const off = dayOffset(st.dueAt, now);
            if (off < FORECAST_DAYS) forecast[off]++;
          }
          if (isDue(st, now)) {
            dueNow++;
            if (new Date(st.dueAt).getTime() < now.getTime() - 86400000) overdueByDay++;
          }
          if (st.phase === 2) {
            retSum += retrievability(scheduler, st, now);
            retCount++;
          }
          if (st.lapses >= 4) leeches.push({ wordId: w.id, senseId: s.id, skill, lapses: st.lapses });
        }
      }
      if (covered) coveredSenses++;
    }
  }

  const accuracyBySkill: Overview["accuracyBySkill"] = {
    de_en: { total: 0, correct: 0, almost: 0 },
    en_de: { total: 0, correct: 0, almost: 0 },
    spelling: { total: 0, correct: 0, almost: 0 },
    pronunciation: { total: 0, correct: 0, almost: 0 }
  };
  const accuracyByLevel = {} as Overview["accuracyByLevel"];
  const errorTypes = { spelling: 0, article: 0, capitalization: 0, umlaut: 0, meaning: 0 };

  for (const e of log) {
    if (e.mode !== "unaided") continue;
    const sk = accuracyBySkill[e.skill];
    sk.total++;
    if (e.outcome === "correct") sk.correct++;
    if (e.outcome === "almost") sk.almost++;
    const lvl = levelBySense.get(e.senseId);
    if (lvl) {
      accuracyByLevel[lvl] ??= { total: 0, correct: 0 };
      accuracyByLevel[lvl].total++;
      if (e.outcome === "correct") accuracyByLevel[lvl].correct++;
    }
    const perSkill = e.skill === "de_en" || e.skill === "en_de" ? errorsBySkill[e.skill] : undefined;
    if (perSkill && e.outcome !== "correct") perSkill.total++;
    for (const r of e.reasons) {
      let kind: keyof typeof errorTypes | undefined;
      if (r.startsWith("Spelling")) kind = "spelling";
      else if (r.includes("article")) kind = "article";
      else if (r.startsWith("Capitalization")) kind = "capitalization";
      else if (r.startsWith("Umlaut")) kind = "umlaut";
      else if (e.outcome === "wrong") kind = "meaning";
      if (kind) {
        errorTypes[kind]++;
        if (perSkill) perSkill[kind]++;
      }
    }
  }

  leeches.sort((a, b) => b.lapses - a.lapses);

  return {
    dueNow,
    overdueByDay,
    buckets,
    bucketsByLevel,
    forecast,
    errorsBySkill,
    totalCards,
    totalSenses,
    estimatedRetention: retCount ? retSum / retCount : 0,
    coverage: totalSenses ? coveredSenses / totalSenses : 0,
    accuracyBySkill,
    accuracyByLevel,
    errorTypes,
    leeches: leeches.slice(0, 20)
  };
}
