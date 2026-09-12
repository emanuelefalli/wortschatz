import { describe, expect, it } from "vitest";
import { buildSession } from "../src/domain/session";
import { DEFAULT_SETTINGS } from "../src/domain/types";
import { WORDS, findWord } from "./fixtures";

describe("list sessions", () => {
  const NOW = new Date("2026-03-10T09:00:00Z");
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
