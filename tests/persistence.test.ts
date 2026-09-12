import { beforeEach, describe, expect, it } from "vitest";
import { createTestDB, SCHEMA_VERSION, type FlashcardDB } from "../src/db/schema";
import {
  exportBackup,
  getActiveSession,
  getAllStates,
  getDailyStats,
  getSettings,
  importBackup,
  importWords,
  recordReview,
  saveSession,
  wordsToCsv
} from "../src/db/repo";
import { applyAnswer, buildSession, currentItem } from "../src/domain/session";
import { applyReview, makeScheduler, newLearningState } from "../src/domain/scheduler";
import { DEFAULT_SETTINGS, stateKey } from "../src/domain/types";
import { localDay } from "../src/domain/time";
import { WORDS } from "./fixtures";

let db: FlashcardDB;
let n = 0;
const NOW = new Date("2026-03-10T09:00:00Z");

beforeEach(async () => {
  db = createTestDB(`test-${Date.now()}-${n++}`);
  await importWords(db, WORDS, "test");
});

describe("import", () => {
  it("is idempotent and skips duplicates within a batch", async () => {
    const again = await importWords(db, [...WORDS, WORDS[0]], "test");
    expect(again.inserted).toBe(0);
    expect(again.skipped).toBe(WORDS.length + 1);
    expect(await db.words.count()).toBe(WORDS.length);
  });
  it("updates changed entries", async () => {
    const changed = { ...WORDS[0], plural: "Zzz" };
    const r = await importWords(db, [changed], "test");
    expect(r.updated).toBe(1);
    expect((await db.words.get(WORDS[0].id))?.plural).toBe("Zzz");
  });
});

describe("recordReview", () => {
  it("writes state, log, session and daily stats atomically", async () => {
    const session = buildSession({
      words: WORDS,
      states: new Map(),
      config: { direction: "de_en", levels: ["A1"], cardCount: 5, newWordLimit: 5, filter: "all" },
      settings: DEFAULT_SETTINGS,
      now: NOW,
      newWordsToday: 0,
      sessionId: "sess-1"
    });
    await saveSession(db, session);
    const item = currentItem(session)!;
    const st = newLearningState(item.wordId, item.senseId, item.skill, NOW);
    const { next } = applyReview(makeScheduler(), st, "correct", NOW);
    const after = applyAnswer(session, item, "correct");
    await recordReview(db, {
      session: after,
      nextState: next,
      log: {
        sessionId: "sess-1",
        wordId: item.wordId,
        senseId: item.senseId,
        skill: item.skill,
        mode: "unaided",
        reviewedAt: NOW.toISOString(),
        outcome: "correct",
        proposedOutcome: "correct",
        overridden: false,
        answerGiven: "x",
        reasons: []
      },
      introducedNew: true,
      outcome: "correct",
      now: NOW
    });
    const states = await getAllStates(db);
    expect(states.get(stateKey(item.senseId, item.skill))?.repetitions).toBe(1);
    expect(await db.reviewLog.count()).toBe(1);
    expect((await getActiveSession(db))?.cursor).toBe(1);
    const day = await getDailyStats(db, localDay(NOW));
    expect(day).toMatchObject({ reviews: 1, newWords: 1, correct: 1 });
  });

  it("rolls back everything when one write fails", async () => {
    const session = buildSession({
      words: WORDS,
      states: new Map(),
      config: { direction: "de_en", levels: ["A1"], cardCount: 5, newWordLimit: 5, filter: "all" },
      settings: DEFAULT_SETTINGS,
      now: NOW,
      newWordsToday: 0,
      sessionId: "sess-2"
    });
    const item = currentItem(session)!;
    const st = newLearningState(item.wordId, item.senseId, item.skill, NOW);
    // A log entry with an explicit id that already exists forces the add() to fail.
    await db.reviewLog.add({
      id: 1,
      sessionId: "other",
      wordId: "w",
      senseId: "s",
      skill: "de_en",
      mode: "unaided",
      reviewedAt: NOW.toISOString(),
      outcome: "correct",
      proposedOutcome: "correct",
      overridden: false,
      answerGiven: "",
      reasons: []
    });
    await expect(
      recordReview(db, {
        session,
        nextState: st,
        log: {
          id: 1,
          sessionId: "sess-2",
          wordId: item.wordId,
          senseId: item.senseId,
          skill: item.skill,
          mode: "unaided",
          reviewedAt: NOW.toISOString(),
          outcome: "correct",
          proposedOutcome: "correct",
          overridden: false,
          answerGiven: "",
          reasons: []
        },
        introducedNew: true,
        outcome: "correct",
        now: NOW
      })
    ).rejects.toThrow();
    expect(await db.learningStates.count()).toBe(0);
    expect(await db.sessions.count()).toBe(0);
    expect(await db.dailyStats.count()).toBe(0);
  });

  it("an interrupted session can be resumed from the persisted cursor", async () => {
    const session = buildSession({
      words: WORDS,
      states: new Map(),
      config: { direction: "en_de", levels: ["A1"], cardCount: 4, newWordLimit: 4, filter: "all" },
      settings: DEFAULT_SETTINGS,
      now: NOW,
      newWordsToday: 0,
      sessionId: "sess-3"
    });
    let s = session;
    for (let i = 0; i < 2; i++) s = applyAnswer(s, currentItem(s)!, "wrong", "x");
    await saveSession(db, s);
    // "Reload": open a fresh connection to the same database name.
    const db2 = createTestDB(db.name);
    const resumed = await getActiveSession(db2);
    expect(resumed?.id).toBe("sess-3");
    expect(resumed?.cursor).toBe(2);
    expect(resumed?.queue.length).toBe(s.queue.length);
    expect(currentItem(resumed!)?.uid).toBe(currentItem(s)?.uid);
  });
});

describe("backup", () => {
  it("round-trips words, states, log and settings", async () => {
    const st = newLearningState(WORDS[0].id, WORDS[0].senses[0].id, "de_en", NOW);
    await db.learningStates.put(applyReview(makeScheduler(), st, "correct", NOW).next);
    await db.settings.put({ ...DEFAULT_SETTINGS, dailyNewWordLimit: 3 });
    const backup = await exportBackup(db, SCHEMA_VERSION);
    expect(backup.words.length).toBe(WORDS.length);
    expect(backup.learningStates.length).toBe(1);

    const db2 = createTestDB(`restore-${Date.now()}`);
    await importBackup(db2, JSON.parse(JSON.stringify(backup)));
    expect(await db2.words.count()).toBe(WORDS.length);
    expect((await getAllStates(db2)).size).toBe(1);
    expect((await getSettings(db2)).dailyNewWordLimit).toBe(3);
  });

  it("exports vocabulary as CSV with one row per sense and quoted fields", () => {
    const csv = wordsToCsv(WORDS);
    const lines = csv.split("\n");
    const senses = WORDS.reduce((n, w) => n + w.senses.length, 0);
    expect(lines.length).toBe(senses + 1);
    expect(lines[0].startsWith("wordId,senseId,lemma")).toBe(true);
    expect(csv).toContain('"Ich möchte kommen, aber ich habe keine Zeit."');
  });
});
