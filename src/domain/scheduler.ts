// FSRS wrapper (spec §5). Maps written-answer outcomes to FSRS grades and
// converts between our LearningState and ts-fsrs Card shapes. Pure functions.

import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from "ts-fsrs";
import type { LearningState, Outcome, Skill, FsrsPhase } from "./types";
import { stateKey } from "./types";

export type SchedulerOptions = {
  requestRetention?: number;
  maximumInterval?: number;
  enableFuzz?: boolean;
};

export function makeScheduler(opts: SchedulerOptions = {}) {
  const params = generatorParameters({
    request_retention: opts.requestRetention ?? 0.9,
    maximum_interval: opts.maximumInterval ?? 365,
    enable_fuzz: opts.enableFuzz ?? false,
    enable_short_term: true,
    // Short in-session steps: a failed card comes back within minutes, and a
    // graduated card is reviewed after a few days (spec §5 qualitative table).
    learning_steps: ["1m", "10m"],
    relearning_steps: ["10m"]
  });
  return fsrs(params);
}

export function outcomeToGrade(outcome: Outcome): Grade {
  switch (outcome) {
    case "correct":
      return Rating.Good;
    case "almost":
      return Rating.Hard;
    case "wrong":
    case "unknown":
      return Rating.Again;
  }
}

export function newLearningState(wordId: string, senseId: string, skill: Skill, now: Date): LearningState {
  const card = createEmptyCard(now);
  return cardToState(card, { wordId, senseId, skill });
}

export function stateToCard(s: LearningState): Card {
  return {
    due: new Date(s.dueAt),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsedDays,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.repetitions,
    lapses: s.lapses,
    state: s.phase as State,
    last_review: s.lastReviewedAt ? new Date(s.lastReviewedAt) : undefined
  };
}

export function cardToState(
  card: Card,
  ids: { wordId: string; senseId: string; skill: Skill },
  extra: Partial<LearningState> = {}
): LearningState {
  return {
    key: stateKey(ids.senseId, ids.skill),
    wordId: ids.wordId,
    senseId: ids.senseId,
    skill: ids.skill,
    dueAt: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    repetitions: card.reps,
    lapses: card.lapses,
    lastReviewedAt: card.last_review ? card.last_review.toISOString() : undefined,
    phase: card.state as FsrsPhase,
    learningSteps: card.learning_steps,
    scheduledDays: card.scheduled_days,
    elapsedDays: card.elapsed_days,
    ...extra
  };
}

export type ScheduleResult = {
  next: LearningState;
  scheduledDays: number;
  /** Milliseconds until next due. */
  intervalMs: number;
};

/** Apply an unaided review outcome to a learning state. */
export function applyReview(
  scheduler: ReturnType<typeof makeScheduler>,
  state: LearningState,
  outcome: Outcome,
  now: Date
): ScheduleResult {
  const card = stateToCard(state);
  const { card: nextCard } = scheduler.next(card, now, outcomeToGrade(outcome));
  const next = cardToState(
    nextCard,
    { wordId: state.wordId, senseId: state.senseId, skill: state.skill },
    { lastResult: outcome, suspended: state.suspended, markedKnownAt: state.markedKnownAt }
  );
  return {
    next,
    scheduledDays: nextCard.scheduled_days,
    intervalMs: nextCard.due.getTime() - now.getTime()
  };
}

/**
 * "Mark as already known": jump the card into the review phase with a
 * comfortable stability so it is not shown as new.
 */
export function markKnown(
  scheduler: ReturnType<typeof makeScheduler>,
  state: LearningState,
  now: Date
): LearningState {
  let card = stateToCard(state);
  // Three consecutive Good/Easy reviews spaced by the scheduled interval.
  let t = now;
  for (const g of [Rating.Good, Rating.Easy, Rating.Easy] as Grade[]) {
    const r = scheduler.next(card, t, g);
    card = r.card;
    t = new Date(card.due.getTime());
  }
  // Re-anchor last review to now and due to now + last interval.
  const intervalDays = Math.max(card.scheduled_days, 7);
  card.last_review = now;
  card.due = new Date(now.getTime() + intervalDays * 86400000);
  return cardToState(
    card,
    { wordId: state.wordId, senseId: state.senseId, skill: state.skill },
    { markedKnownAt: now.toISOString(), lastResult: "correct" }
  );
}

export function retrievability(scheduler: ReturnType<typeof makeScheduler>, state: LearningState, now: Date): number {
  if (state.phase === 0) return 0;
  return scheduler.get_retrievability(stateToCard(state), now, false);
}

export type MaturityBucket = "new" | "learning" | "mature" | "suspended";

/** Classify a state for progress reporting (spec §9). Mature = stability ≥ 21 days. */
export function maturity(state: LearningState): MaturityBucket {
  if (state.suspended) return "suspended";
  if (state.phase === 0 && state.repetitions === 0) return "new";
  if (state.phase === 2 && state.stability >= 21) return "mature";
  return "learning";
}

export function isDue(state: LearningState, now: Date): boolean {
  return !state.suspended && state.repetitions > 0 && new Date(state.dueAt).getTime() <= now.getTime();
}
