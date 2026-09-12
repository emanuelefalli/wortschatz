// Session building and in-session dynamics (spec §3). Pure functions over
// plain data; persistence happens in the repository.

import type {
  LearningState,
  Outcome,
  QueueItem,
  ReviewMode,
  SessionConfig,
  SessionDiagnostics,
  SessionRecord,
  Settings,
  Skill,
  Word,
  WordSense
} from "./types";
import { PHASE1_SKILLS, stateKey } from "./types";
import { isDue } from "./scheduler";

/**
 * A word sense counts against the daily new-word allowance only on its very
 * first unaided review in any direction, so a mixed session that shows both
 * directions of one word uses one unit of the allowance.
 */
export function isFirstIntroduction(states: (LearningState | undefined)[]): boolean {
  return states.every((st) => !st || st.repetitions === 0);
}

export const NEW_WORD_SKILLS = PHASE1_SKILLS;

export type BuildInput = {
  words: Word[];
  states: Map<string, LearningState>;
  config: SessionConfig;
  settings: Settings;
  now: Date;
  /** New words already introduced today (local day). */
  newWordsToday: number;
  sessionId: string;
  /** When set, only these senses are eligible (personal list). */
  listSenseIds?: Set<string>;
};

/** A secondary sense unlocks once the first sense is in review with a week of stability. */
export function isSenseStable(state: LearningState | undefined): boolean {
  return !!state && state.phase === 2 && state.stability >= 7;
}

export function skillsFor(direction: SessionConfig["direction"]): Skill[] {
  if (direction === "mixed") return ["de_en", "en_de"];
  if (direction === "pronunciation") return ["pronunciation"];
  return [direction];
}

type Candidate = { word: Word; sense: WordSense; skill: Skill; state?: LearningState };

/** Cards due within this window count as "due" for weak-word sessions (learning steps are minutes long). */
export const WEAK_DUE_WINDOW_MS = 60 * 60000;

/**
 * A card is weak when it has lapsed or its last unaided result was not
 * correct, and it is due now or within the next hour. Cards that are not
 * close to due are never pulled forward, even for weak-word practice.
 */
export function isWeak(state: LearningState | undefined, now: Date): boolean {
  if (!state || state.suspended || state.repetitions === 0) return false;
  const failedBefore = state.lapses > 0 || (state.lastResult !== undefined && state.lastResult !== "correct");
  return failedBefore && new Date(state.dueAt).getTime() <= now.getTime() + WEAK_DUE_WINDOW_MS;
}

/** Count weak cards for the dashboard. */
export function countWeak(states: Iterable<LearningState>, now: Date): number {
  let n = 0;
  for (const st of states) if (isWeak(st, now)) n++;
  return n;
}

function passesFilter(c: Candidate, filter: SessionConfig["filter"], now: Date): boolean {
  const reviewed = !!c.state && c.state.repetitions > 0;
  switch (filter) {
    case "all":
      return true;
    case "new":
      return !reviewed;
    case "due":
      return !!c.state && isDue(c.state, now);
    case "weak":
      return isWeak(c.state, now);
    case "nouns":
      return c.word.partOfSpeech === "noun";
    case "verbs":
      return c.word.partOfSpeech === "verb";
  }
}

function makeItem(c: Candidate, index: number, isNew: boolean, mode: ReviewMode = "unaided", retry = false): QueueItem {
  return {
    uid: `${c.sense.id}|${c.skill}|${mode}|${index}`,
    senseId: c.sense.id,
    wordId: c.word.id,
    skill: c.skill,
    mode,
    isNew,
    retry
  };
}

/**
 * Build a session queue: overdue reviews first (most overdue first), then new
 * words up to the remaining daily allowance. Cards that are not yet due are
 * never pulled forward to fill the session.
 */
export function buildSession(input: BuildInput): SessionRecord {
  const { words, states, config, now } = input;
  const skills = skillsFor(config.direction);
  const levelSet = new Set(config.levels);

  const pronunciation = config.direction === "pronunciation";
  // Pronunciation practises words the learner has already met in translation (unless nothing has been met yet).
  const introduced = new Set<string>();
  if (pronunciation) {
    for (const st of states.values()) if ((st.skill === "de_en" || st.skill === "en_de") && st.repetitions > 0) introduced.add(st.senseId);
  }

  const candidates: Candidate[] = [];
  for (const word of words.filter((w) => levelSet.has(w.cefrLevel))) {
    for (const sense of word.senses) {
      if (input.listSenseIds && !input.listSenseIds.has(sense.id)) continue;
      if (pronunciation && introduced.size > 0 && !introduced.has(sense.id)) continue;
      if (sense.order > 1) {
        // Unlock secondary meanings only after the first meaning is stable in this skill.
        const prev = word.senses.find((s) => s.order === sense.order - 1);
        if (!prev) continue;
        const stableInAll = skills.every((sk) => isSenseStable(states.get(stateKey(prev.id, sk))));
        if (!stableInAll) continue;
      }
      for (const skill of skills) {
        const state = states.get(stateKey(sense.id, skill));
        if (state?.suspended) continue;
        candidates.push({ word, sense, skill, state });
      }
    }
  }

  const filtered = candidates.filter((c) => passesFilter(c, config.filter, now));

  // Each word sense appears at most once per session (plus its own cloze /
  // retry). In mixed mode the two directions of one word are therefore never
  // shown back to back; the other direction waits for a later session.
  const usedSenses = new Set<string>();

  // Weak-word sessions may include cards due within the next hour (learning steps).
  const dueNow = (c: Candidate) => (config.filter === "weak" ? isWeak(c.state, now) : !!c.state && isDue(c.state, now));
  const due = filtered
    .filter(dueNow)
    .sort((a, b) => new Date(a.state!.dueAt).getTime() - new Date(b.state!.dueAt).getTime());

  const queue: QueueItem[] = [];
  let index = 0;
  for (const c of due) {
    if (queue.length >= config.cardCount) break;
    if (usedSenses.has(c.sense.id)) continue; // the more overdue direction was already taken
    usedSenses.add(c.sense.id);
    queue.push(makeItem(c, index++, false));
  }

  // New words: one direction per sense. When both directions are untouched,
  // mixed sessions alternate so the learner sees both kinds of card without
  // meeting the same word twice.
  const freshBySense = new Map<string, Candidate[]>();
  for (const c of filtered) {
    if (c.state && c.state.repetitions > 0) continue;
    if (usedSenses.has(c.sense.id)) continue;
    if (!freshBySense.has(c.sense.id)) freshBySense.set(c.sense.id, []);
    freshBySense.get(c.sense.id)!.push(c);
  }
  const freshSenses = [...freshBySense.values()].sort((a, b) => a[0].word.frequencyRank - b[0].word.frequencyRank);

  const remainingToday = Math.max(0, input.settings.dailyNewWordLimit - input.newWordsToday);
  // Pronunciation cards are not new vocabulary, so the daily new-word limit does not apply.
  const allowance = Math.max(0, config.ignoreDailyLimit || pronunciation ? config.newWordLimit : Math.min(config.newWordLimit, remainingToday));
  const newSenseIds: string[] = [];
  let alternate = 0;
  let pronunciationCount = 0;
  for (const options of freshSenses) {
    if (queue.length >= config.cardCount) break;
    const introducedBefore = pronunciation || options.some((c) => !!c.state && c.state.repetitions > 0) || senseReviewedElsewhere(states, options[0].sense.id);
    if (!introducedBefore && newSenseIds.length >= allowance) continue;
    if (pronunciation && pronunciationCount >= allowance) continue;
    const pick = chooseDirection(options, alternate++);
    if (pronunciation) pronunciationCount++;
    if (!introducedBefore) newSenseIds.push(pick.sense.id);
    usedSenses.add(pick.sense.id);
    queue.push(makeItem(pick, index++, true));
  }

  // Why a session may be empty, for the UI to explain (spec §3: never pull cards forward).
  let nextDueAt: string | undefined;
  for (const c of candidates) {
    if (c.state && c.state.repetitions > 0 && !isDue(c.state, now)) {
      if (!nextDueAt || c.state.dueAt < nextDueAt) nextDueAt = c.state.dueAt;
    }
  }
  const diagnostics: SessionDiagnostics = {
    availableNew: freshSenses.length,
    allowance,
    remainingToday,
    dailyLimit: input.settings.dailyNewWordLimit,
    dueCount: due.length,
    nextDueAt
  };

  return {
    id: input.sessionId,
    config,
    startedAt: now.toISOString(),
    queue,
    cursor: 0,
    answered: [],
    newSenseIds,
    status: queue.length ? "active" : "finished",
    diagnostics
  };
}

/** True when the sense has been reviewed in some direction not part of this session's skills. */
function senseReviewedElsewhere(states: Map<string, LearningState>, senseId: string): boolean {
  return PHASE1_SKILLS.some((sk) => (states.get(stateKey(senseId, sk))?.repetitions ?? 0) > 0);
}

/**
 * Pick which direction of an unseen sense to show. Prefer a direction that
 * has never been reviewed; among equals alternate de_en / en_de.
 */
function chooseDirection(options: Candidate[], alternate: number): Candidate {
  if (options.length === 1) return options[0];
  const untouched = options.filter((c) => !c.state || c.state.repetitions === 0);
  const pool = untouched.length ? untouched : options;
  const ordered = [...pool].sort((a, b) => a.skill.localeCompare(b.skill)); // de_en before en_de
  return ordered[alternate % ordered.length];
}

export const CLOZE_GAP = 3;
export const RETRY_GAP = 3;
export const MAX_RETRIES = 2;

function insertAt(queue: QueueItem[], item: QueueItem, position: number): QueueItem[] {
  const pos = Math.min(Math.max(position, 0), queue.length);
  return [...queue.slice(0, pos), item, ...queue.slice(pos)];
}

function retriesSoFar(session: SessionRecord, item: QueueItem): number {
  return session.queue.filter((q) => q.senseId === item.senseId && q.skill === item.skill && q.retry).length;
}

/**
 * Advance the session after an answer. On failure (wrong/unknown) a cloze
 * exercise is inserted a few cards later and an unaided retry after that.
 * On "almost" only the unaided retry is inserted.
 */
export function applyAnswer(
  session: SessionRecord,
  item: QueueItem,
  outcome: Outcome,
  sentenceId?: string
): SessionRecord {
  let queue = session.queue;
  const cursor = session.cursor + 1;
  const answered = [...session.answered, { uid: item.uid, outcome, mode: item.mode }];

  if (item.mode === "unaided" && outcome !== "correct" && retriesSoFar(session, item) < MAX_RETRIES) {
    const base = { ...item, isNew: false };
    let pos = cursor + CLOZE_GAP;
    if (outcome === "wrong" || outcome === "unknown") {
      const cloze: QueueItem = { ...base, uid: `${item.uid}|cloze|${answered.length}`, mode: "cloze", retry: false, sentenceId };
      queue = insertAt(queue, cloze, pos);
      pos += RETRY_GAP;
    }
    const retry: QueueItem = { ...base, uid: `${item.uid}|retry|${answered.length}`, mode: "unaided", retry: true };
    queue = insertAt(queue, retry, pos);
  }

  const finished = cursor >= queue.length;
  return {
    ...session,
    queue,
    cursor,
    answered,
    status: finished ? "finished" : "active",
    endedAt: finished ? new Date().toISOString() : session.endedAt
  };
}

export function currentItem(session: SessionRecord): QueueItem | undefined {
  return session.queue[session.cursor];
}

export function sessionSummary(session: SessionRecord) {
  const unaided = session.answered.filter((a) => a.mode === "unaided");
  const count = (o: Outcome) => unaided.filter((a) => a.outcome === o).length;
  return {
    total: unaided.length,
    correct: count("correct"),
    almost: count("almost"),
    wrong: count("wrong") + count("unknown"),
    cloze: session.answered.filter((a) => a.mode === "cloze").length,
    newWords: session.newSenseIds.length
  };
}
