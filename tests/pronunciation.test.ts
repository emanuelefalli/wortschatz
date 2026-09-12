import { describe, expect, it } from "vitest";
import { gradePronunciation } from "../src/domain/grader";
import { buildSession } from "../src/domain/session";
import { applyReview, makeScheduler, newLearningState } from "../src/domain/scheduler";
import { DEFAULT_SETTINGS, type LearningState } from "../src/domain/types";
import { WORDS, findWord } from "./fixtures";

describe("gradePronunciation", () => {
  it("accepts a transcript containing the word, umlaut- and case-insensitively", () => {
    expect(gradePronunciation("der Vorschlag", ["Vorschlag"]).outcome).toBe("correct");
    expect(gradePronunciation("schön", ["schoen"]).outcome).toBe("correct");
    expect(gradePronunciation("laufen", ["ich laufen gern"]).outcome).toBe("correct");
  });
  it("uses alternatives and marks near misses as almost", () => {
    expect(gradePronunciation("Tisch", ["Fisch", "Tisch"]).outcome).toBe("correct");
    expect(gradePronunciation("Vorschlag", ["Vorschlack"]).outcome).toBe("almost");
    expect(gradePronunciation("Vorschlag", ["Nachbar"]).outcome).toBe("wrong");
  });
});

describe("pronunciation sessions", () => {
  const NOW = new Date("2026-03-10T09:00:00Z");
  it("practises words already met in translation and ignores the daily new-word limit", () => {
    const sched = makeScheduler();
    const states = new Map<string, LearningState>();
    for (const lemma of ["Tisch", "Haus", "Zug"]) {
      const w = findWord(lemma);
      const st = applyReview(sched, newLearningState(w.id, w.senses[0].id, "de_en", NOW), "correct", NOW).next;
      states.set(st.key, st);
    }
    const s = buildSession({
      words: WORDS,
      states,
      config: { direction: "pronunciation", levels: ["A1"], cardCount: 20, newWordLimit: 10, filter: "all" },
      settings: DEFAULT_SETTINGS,
      now: NOW,
      newWordsToday: 10, // allowance exhausted – irrelevant for pronunciation
      sessionId: "p1"
    });
    expect(s.queue.length).toBe(3);
    expect(s.queue.every((i) => i.skill === "pronunciation")).toBe(true);
    expect(s.newSenseIds).toEqual([]);
  });
  it("restricts a session to a personal list", () => {
    const tisch = findWord("Tisch");
    const s = buildSession({
      words: WORDS,
      states: new Map(),
      config: { direction: "de_en", levels: ["A1"], cardCount: 20, newWordLimit: 10, filter: "all", listId: "l" },
      settings: DEFAULT_SETTINGS,
      now: NOW,
      newWordsToday: 0,
      sessionId: "l1",
      listSenseIds: new Set([tisch.senses[0].id])
    });
    expect(s.queue.map((i) => i.senseId)).toEqual([tisch.senses[0].id]);
  });
});
