import { beforeAll, describe, expect, it } from "vitest";
import { createTestDB, SCHEMA_VERSION } from "../src/db/schema";
import { exportBackup, getAllStates, importWords, recordReview, saveList, saveSettings, getSettings, getLists } from "../src/db/repo";
import { applyReview, makeScheduler, newLearningState } from "../src/domain/scheduler";
import { applyAnswer, buildSession, currentItem } from "../src/domain/session";
import { DEFAULT_SETTINGS, stateKey, type ReviewLogEntry } from "../src/domain/types";
import { decryptText, encryptText, WrongPassphraseError } from "../src/sync/crypto";
import { dailyStatsFromLog, mergeBackups, contentSignature } from "../src/sync/merge";
import { MemoryProvider, SyncConflictError } from "../src/sync/provider";
import { syncNow } from "../src/sync/engine";
import { WORDS } from "./fixtures";

beforeAll(async () => {
  if (!globalThis.crypto?.subtle) {
    const { webcrypto } = await import("node:crypto");
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  }
});

const T = (h: number) => new Date(Date.UTC(2026, 2, 10, h)).toISOString();
const sched = makeScheduler();

function logEntry(over: Partial<ReviewLogEntry>): ReviewLogEntry {
  return {
    sessionId: "s",
    wordId: "w",
    senseId: "x",
    skill: "de_en",
    mode: "unaided",
    reviewedAt: T(9),
    outcome: "correct",
    proposedOutcome: "correct",
    overridden: false,
    answerGiven: "",
    reasons: [],
    ...over
  };
}

async function freshDb(name: string) {
  const db = createTestDB(`${name}-${Date.now()}-${Math.random()}`);
  await importWords(db, WORDS, "t");
  return db;
}

/** Review the first new card of a de_en session on this device and persist it. */
async function reviewOne(db: Awaited<ReturnType<typeof freshDb>>, sessionId: string, at: Date, outcome: "correct" | "wrong" = "correct") {
  const states = await getAllStates(db);
  const s = buildSession({ words: WORDS, states, config: { direction: "de_en", levels: ["A1"], cardCount: 1, newWordLimit: 1, filter: "all" }, settings: { ...DEFAULT_SETTINGS, dailyNewWordLimit: 100 }, now: at, newWordsToday: 0, sessionId });
  const item = currentItem(s)!;
  const prev = states.get(stateKey(item.senseId, item.skill)) ?? newLearningState(item.wordId, item.senseId, item.skill, at);
  const { next } = applyReview(sched, prev, outcome, at);
  const after = applyAnswer(s, item, outcome);
  await recordReview(db, {
    session: after,
    nextState: next,
    log: logEntry({ sessionId, wordId: item.wordId, senseId: item.senseId, reviewedAt: at.toISOString(), outcome, proposedOutcome: outcome }),
    introducedNew: prev.repetitions === 0,
    outcome,
    now: at
  });
  return item.senseId;
}

describe("encryption", () => {
  it("round-trips and rejects a wrong passphrase", async () => {
    const blob = await encryptText('{"a":1,"ü":"ß"}', "correct horse");
    expect(blob.data).not.toContain("ß");
    expect(JSON.stringify(blob)).not.toContain('"a":1');
    expect(await decryptText(blob, "correct horse")).toBe('{"a":1,"ü":"ß"}');
    await expect(decryptText(blob, "wrong")).rejects.toBeInstanceOf(WrongPassphraseError);
  });
});

describe("merge", () => {
  it("unions review logs, keeps the later learning state, and recomputes daily stats", async () => {
    const db = await freshDb("m");
    const base = await exportBackup(db, SCHEMA_VERSION);
    const st = newLearningState(WORDS[0].id, WORDS[0].senses[0].id, "de_en", new Date(T(8)));
    const a1 = applyReview(sched, st, "correct", new Date(T(9))).next;
    const a2 = applyReview(sched, a1, "correct", new Date(T(10))).next;
    const A = { ...base, learningStates: [a1], reviewLog: [logEntry({ sessionId: "A", senseId: st.senseId, reviewedAt: T(9) })] };
    const B = { ...base, learningStates: [a2], reviewLog: [logEntry({ sessionId: "A", senseId: st.senseId, reviewedAt: T(9) }), logEntry({ sessionId: "B", senseId: st.senseId, reviewedAt: T(10), outcome: "almost" })] };
    const m = mergeBackups(A, B);
    expect(m.reviewLog.length).toBe(2);
    expect(m.learningStates[0].repetitions).toBe(2);
    expect(m.dailyStats).toEqual(dailyStatsFromLog(m.reviewLog));
    expect(m.dailyStats[0]).toMatchObject({ reviews: 2, newWords: 1, correct: 1, almost: 1 });
    // Symmetric and idempotent
    expect(contentSignature(mergeBackups(B, A))).toBe(contentSignature(m));
    expect(contentSignature(mergeBackups(m, m))).toBe(contentSignature(m));
  });

  it("newer settings win and active sessions are never synced", async () => {
    const db = await freshDb("s");
    const base = await exportBackup(db, SCHEMA_VERSION);
    const older = { ...base.settings, dailyNewWordLimit: 5, updatedAt: T(1) };
    const newer = { ...base.settings, dailyNewWordLimit: 30, updatedAt: T(2) };
    const remoteSession = { id: "r1", config: { direction: "de_en" as const, levels: ["A1" as const], cardCount: 5, newWordLimit: 5, filter: "all" as const }, startedAt: T(3), queue: [], cursor: 0, answered: [], newSenseIds: [], status: "active" as const };
    const m = mergeBackups({ ...base, settings: older }, { ...base, settings: newer, sessions: [remoteSession] });
    expect(m.settings.dailyNewWordLimit).toBe(30);
    expect(m.sessions).toEqual([]);
  });
});

describe("sync engine (two devices, one account)", () => {
  it("propagates reviews, lists and settings both ways and reports status", async () => {
    const cloud = new MemoryProvider();
    const pw = "hunter2 hunter2";
    const A = await freshDb("A");
    const B = await freshDb("B");

    await reviewOne(A, "sA1", new Date(T(9)));
    const r1 = await syncNow(A, cloud, pw);
    expect(r1.status).toBe("uploaded");
    expect(r1.remoteVersion).toBe(1);

    const r2 = await syncNow(B, cloud, pw);
    expect(r2.status).toBe("downloaded");
    expect((await B.reviewLog.count())).toBe(1);
    expect((await getAllStates(B)).size).toBe(1);

    await saveList(B, { id: "l1", name: "Kitchen", senseIds: [WORDS[5].senses[0].id], createdAt: T(10), updatedAt: T(10) });
    await saveSettings(B, { ...(await getSettings(B)), dailyNewWordLimit: 25 });
    await reviewOne(B, "sB1", new Date(T(11)), "wrong");
    const r3 = await syncNow(B, cloud, pw);
    expect(r3.status).toBe("uploaded");
    expect(r3.remoteVersion).toBe(2);

    await reviewOne(A, "sA2", new Date(T(12)));
    const r4 = await syncNow(A, cloud, pw);
    expect(r4.status).toBe("merged");
    expect(r4.remoteVersion).toBe(3);
    expect(await A.reviewLog.count()).toBe(3);
    expect((await getLists(A)).map((l) => l.name)).toEqual(["Kitchen"]);
    expect((await getSettings(A)).dailyNewWordLimit).toBe(25);

    const r5 = await syncNow(B, cloud, pw);
    expect(r5.status).toBe("downloaded");
    const { getActiveSession } = await import("../src/db/repo");
    expect((await getActiveSession(B))?.id).toBe("sB1"); // B's unfinished session survived the download
    const r6 = await syncNow(B, cloud, pw);
    expect(r6.status).toBe("unchanged");
    const canon = async (db: Awaited<ReturnType<typeof freshDb>>) => {
      const b = await exportBackup(db, SCHEMA_VERSION);
      return contentSignature(mergeBackups(b, b)); // canonical form ignores the device-local active session
    };
    expect(await canon(A)).toBe(await canon(B));
  });

  it("retries on a version conflict and fails clearly on a wrong passphrase", async () => {
    const cloud = new MemoryProvider();
    const A = await freshDb("C");
    await reviewOne(A, "s1", new Date(T(9)));
    await syncNow(A, cloud, "pw");
    // Simulate another device writing between download and upload.
    let raced = false;
    const racing = {
      kind: "racing",
      isSignedIn: () => cloud.isSignedIn(),
      download: async () => {
        const d = await cloud.download();
        if (!raced) {
          raced = true;
          await cloud.upload(d!.payload, d!.version); // bump version behind our back
        }
        return d;
      },
      upload: (p: string, v: number | null) => cloud.upload(p, v)
    };
    await reviewOne(A, "s2", new Date(T(10)));
    const r = await syncNow(A, racing, "pw");
    expect(r.status).toBe("uploaded");
    expect(r.remoteVersion).toBe(3);
    await expect(syncNow(A, cloud, "other")).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(new MemoryProvider().upload("x", 5)).rejects.toBeInstanceOf(SyncConflictError);
  });
});
