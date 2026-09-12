import { describe, expect, it } from "vitest";
import { applyAnswer, buildSession, countWeak, currentItem, isSenseStable, isWeak, sessionSummary, CLOZE_GAP, RETRY_GAP } from "../src/domain/session";
import { applyReview, makeScheduler, newLearningState } from "../src/domain/scheduler";
import { DEFAULT_SETTINGS, stateKey, type LearningState, type SessionConfig } from "../src/domain/types";
import { WORDS, findWord } from "./fixtures";

const NOW = new Date("2026-03-10T09:00:00Z");
const sched = makeScheduler();

const baseConfig: SessionConfig = {
  direction: "de_en",
  levels: ["A1", "A2"],
  cardCount: 20,
  newWordLimit: 10,
  filter: "all"
};

function build(overrides: Partial<Parameters<typeof buildSession>[0]> = {}) {
  return buildSession({
    words: WORDS,
    states: new Map(),
    config: baseConfig,
    settings: DEFAULT_SETTINGS,
    now: NOW,
    newWordsToday: 0,
    sessionId: "s1",
    ...overrides
  });
}

/** Create a reviewed state whose next due is at `dueAt`. */
function reviewedState(senseId: string, wordId: string, skill: "de_en" | "en_de", dueAt: Date): LearningState {
  let st = newLearningState(wordId, senseId, skill, new Date(dueAt.getTime() - 3 * 86400000));
  st = applyReview(sched, st, "correct", new Date(dueAt.getTime() - 3 * 86400000)).next;
  return { ...st, dueAt: dueAt.toISOString(), phase: 2, stability: 3 };
}

describe("buildSession", () => {
  it("introduces new words by frequency rank up to the daily limit", () => {
    const s = build();
    expect(s.queue.length).toBe(10);
    expect(s.queue.every((i) => i.isNew && i.skill === "de_en")).toBe(true);
    expect(s.newSenseIds.length).toBe(10);
    expect(s.queue[0].wordId).toBe(WORDS[0].id);
  });

  it("respects new words already introduced today, explains an empty session, and allows an explicit override", () => {
    const s = build({ newWordsToday: 7 });
    expect(s.queue.length).toBe(3);
    const empty = build({ newWordsToday: 10 });
    expect(empty.status).toBe("finished");
    expect(empty.diagnostics).toMatchObject({ allowance: 0, remainingToday: 0, dailyLimit: 10, dueCount: 0 });
    expect(empty.diagnostics!.availableNew).toBeGreaterThan(100);
    const forced = build({ newWordsToday: 10, config: { ...baseConfig, newWordLimit: 5, ignoreDailyLimit: true } });
    expect(forced.queue.length).toBe(5);
    expect(forced.newSenseIds.length).toBe(5);
  });

  it("puts overdue reviews first, most overdue first, and never pulls future cards forward", () => {
    const tisch = findWord("Tisch");
    const haus = findWord("Haus");
    const zug = findWord("Zug");
    const states = new Map<string, LearningState>();
    const a = reviewedState(tisch.senses[0].id, tisch.id, "de_en", new Date(NOW.getTime() - 3600000)); // 1h overdue
    const b = reviewedState(haus.senses[0].id, haus.id, "de_en", new Date(NOW.getTime() - 2 * 86400000)); // 2d overdue
    const c = reviewedState(zug.senses[0].id, zug.id, "de_en", new Date(NOW.getTime() + 86400000)); // tomorrow
    for (const st of [a, b, c]) states.set(st.key, st);

    const s = build({ states, config: { ...baseConfig, cardCount: 5 } });
    expect(s.queue[0].senseId).toBe(haus.senses[0].id);
    expect(s.queue[1].senseId).toBe(tisch.senses[0].id);
    expect(s.queue.some((i) => i.senseId === zug.senses[0].id)).toBe(false);
    expect(s.queue.slice(2).every((i) => i.isNew)).toBe(true);
    expect(s.queue.length).toBe(5);
  });

  it("'due' filter yields no new cards and 'new' filter yields no reviews", () => {
    const tisch = findWord("Tisch");
    const states = new Map<string, LearningState>();
    const a = reviewedState(tisch.senses[0].id, tisch.id, "de_en", new Date(NOW.getTime() - 3600000));
    states.set(a.key, a);
    const due = build({ states, config: { ...baseConfig, filter: "due" } });
    expect(due.queue.length).toBe(1);
    expect(due.queue[0].isNew).toBe(false);
    const fresh = build({ states, config: { ...baseConfig, filter: "new" } });
    expect(fresh.queue.every((i) => i.isNew)).toBe(true);
  });

  it("mixed direction shows each word once, alternating directions across words", () => {
    const s = build({ config: { ...baseConfig, direction: "mixed", cardCount: 40, newWordLimit: 6 } });
    expect(s.newSenseIds.length).toBe(6);
    expect(s.queue.length).toBe(6);
    expect(new Set(s.queue.map((i) => i.senseId)).size).toBe(6);
    expect(s.queue.map((i) => i.skill)).toEqual(["de_en", "en_de", "de_en", "en_de", "de_en", "en_de"]);
  });

  it("mixed direction introduces the untouched direction of a word seen the other way, without charging the daily allowance", () => {
    const tisch = findWord("Tisch");
    const states = new Map<string, LearningState>();
    // de_en reviewed and not due yet; en_de never seen.
    const a = reviewedState(tisch.senses[0].id, tisch.id, "de_en", new Date(NOW.getTime() + 5 * 86400000));
    states.set(a.key, a);
    const s = build({ states, config: { ...baseConfig, direction: "mixed", cardCount: 3, newWordLimit: 2 }, newWordsToday: 10 });
    // Allowance is exhausted, yet Tisch en_de is allowed because the word was already introduced.
    expect(s.queue.length).toBe(1);
    expect(s.queue[0]).toMatchObject({ senseId: tisch.senses[0].id, skill: "en_de" });
    expect(s.newSenseIds).toEqual([]);
  });

  it("when both directions of a word are due, only the more overdue one is shown", () => {
    const tisch = findWord("Tisch");
    const states = new Map<string, LearningState>();
    const a = reviewedState(tisch.senses[0].id, tisch.id, "de_en", new Date(NOW.getTime() - 3600000));
    const b = reviewedState(tisch.senses[0].id, tisch.id, "en_de", new Date(NOW.getTime() - 2 * 86400000));
    states.set(a.key, a);
    states.set(b.key, b);
    const s = build({ states, config: { ...baseConfig, direction: "mixed", filter: "due" } });
    expect(s.queue.length).toBe(1);
    expect(s.queue[0].skill).toBe("en_de");
  });

  it("'weak' filter includes lapsed cards due within the hour and excludes clean or far-future cards", () => {
    const tisch = findWord("Tisch");
    const haus = findWord("Haus");
    const zug = findWord("Zug");
    const states = new Map<string, LearningState>();
    const lapsedSoon = { ...reviewedState(tisch.senses[0].id, tisch.id, "de_en", new Date(NOW.getTime() + 30 * 60000)), lapses: 1 };
    const cleanDue = reviewedState(haus.senses[0].id, haus.id, "de_en", new Date(NOW.getTime() - 60000));
    const lapsedFar = { ...reviewedState(zug.senses[0].id, zug.id, "de_en", new Date(NOW.getTime() + 3 * 86400000)), lapses: 2 };
    for (const st of [lapsedSoon, cleanDue, lapsedFar]) states.set(st.key, st);
    expect(isWeak(lapsedSoon, NOW)).toBe(true);
    expect(isWeak(cleanDue, NOW)).toBe(false);
    expect(isWeak(lapsedFar, NOW)).toBe(false);
    expect(countWeak(states.values(), NOW)).toBe(1);
    const s = build({ states, config: { ...baseConfig, filter: "weak" } });
    expect(s.queue.map((i) => i.senseId)).toEqual([tisch.senses[0].id]);
  });

  it("directions are independent: a due en_de card does not make de_en due", () => {
    const tisch = findWord("Tisch");
    const states = new Map<string, LearningState>();
    const a = reviewedState(tisch.senses[0].id, tisch.id, "en_de", new Date(NOW.getTime() - 3600000));
    states.set(a.key, a);
    const s = build({ states, config: { ...baseConfig, direction: "de_en", filter: "due" } });
    expect(s.queue.length).toBe(0);
  });

  it("locks secondary senses until the first sense is stable", () => {
    const laufen = findWord("laufen");
    expect(laufen.senses.length).toBe(2);
    const s1 = build({ config: { ...baseConfig, cardCount: 400, newWordLimit: 400 }, settings: { ...DEFAULT_SETTINGS, dailyNewWordLimit: 400 } });
    expect(s1.queue.some((i) => i.senseId === laufen.senses[1].id)).toBe(false);

    const states = new Map<string, LearningState>();
    const stable = { ...reviewedState(laufen.senses[0].id, laufen.id, "de_en", new Date(NOW.getTime() + 86400000)), stability: 30 };
    states.set(stable.key, stable);
    expect(isSenseStable(states.get(stateKey(laufen.senses[0].id, "de_en")))).toBe(true);
    const s2 = build({ states, config: { ...baseConfig, cardCount: 400, newWordLimit: 400 }, settings: { ...DEFAULT_SETTINGS, dailyNewWordLimit: 400 } });
    expect(s2.queue.some((i) => i.senseId === laufen.senses[1].id)).toBe(true);
  });
});

describe("applyAnswer", () => {
  it("a wrong answer schedules a cloze and then an unaided retry later in the session", () => {
    let s = build();
    const first = currentItem(s)!;
    s = applyAnswer(s, first, "wrong", "sent-1");
    const cloze = s.queue[s.cursor + CLOZE_GAP];
    expect(cloze.mode).toBe("cloze");
    expect(cloze.senseId).toBe(first.senseId);
    expect(cloze.sentenceId).toBe("sent-1");
    const retry = s.queue[s.cursor + CLOZE_GAP + RETRY_GAP];
    expect(retry.mode).toBe("unaided");
    expect(retry.retry).toBe(true);
    expect(retry.senseId).toBe(first.senseId);
    expect(s.queue.length).toBe(12);
  });

  it("'I don't know' behaves like wrong; 'almost' schedules a retry without a cloze", () => {
    let s = build();
    s = applyAnswer(s, currentItem(s)!, "unknown", "x");
    expect(s.queue.filter((i) => i.mode === "cloze").length).toBe(1);
    let t = build();
    t = applyAnswer(t, currentItem(t)!, "almost");
    expect(t.queue.filter((i) => i.mode === "cloze").length).toBe(0);
    expect(t.queue.filter((i) => i.retry).length).toBe(1);
  });

  it("a correct answer inserts nothing and finishes the session at the end", () => {
    let s = build({ config: { ...baseConfig, cardCount: 2, newWordLimit: 2 } });
    s = applyAnswer(s, currentItem(s)!, "correct");
    expect(s.queue.length).toBe(2);
    expect(s.status).toBe("active");
    s = applyAnswer(s, currentItem(s)!, "correct");
    expect(s.status).toBe("finished");
    expect(sessionSummary(s)).toMatchObject({ total: 2, correct: 2, newWords: 2 });
  });

  it("caps retries so a card cannot loop forever", () => {
    let s = build({ config: { ...baseConfig, cardCount: 1, newWordLimit: 1 } });
    for (let i = 0; i < 6 && s.status === "active"; i++) {
      const item = currentItem(s)!;
      s = applyAnswer(s, item, item.mode === "cloze" ? "wrong" : "wrong", "x");
    }
    expect(s.status).toBe("finished");
    expect(s.queue.filter((i) => i.retry).length).toBe(2);
  });
});

describe("isFirstIntroduction", () => {
  it("is true only when no direction of the sense has been reviewed", async () => {
    const { isFirstIntroduction } = await import("../src/domain/session");
    const fresh = newLearningState("w", "s", "de_en", NOW);
    const reviewed = applyReview(sched, newLearningState("w", "s", "en_de", NOW), "correct", NOW).next;
    expect(isFirstIntroduction([undefined, undefined])).toBe(true);
    expect(isFirstIntroduction([fresh, undefined])).toBe(true);
    expect(isFirstIntroduction([fresh, reviewed])).toBe(false);
  });
});
