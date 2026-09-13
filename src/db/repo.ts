// Repository: all reads/writes go through here so the UI never touches Dexie
// directly and every review result is written in a single transaction.

import type { FlashcardDB } from "./schema";
import { DEFAULT_SETTINGS } from "../domain/types";
import type {
  ContentReport,
  CustomAnswer,
  DailyStats,
  LearningState,
  Outcome,
  PersonalList,
  ReviewLogEntry,
  SessionRecord,
  Settings,
  Skill,
  Word
} from "../domain/types";
import { localDay } from "../domain/time";
import { stateKey } from "../domain/types";

export type ImportSummary = { inserted: number; updated: number; skipped: number };

/** Import words idempotently. Duplicate ids within the batch are skipped. */
export async function importWords(db: FlashcardDB, words: Word[], datasetTag: string): Promise<ImportSummary> {
  const seen = new Set<string>();
  const summary: ImportSummary = { inserted: 0, updated: 0, skipped: 0 };
  await db.transaction("rw", db.words, db.meta, async () => {
    for (const w of words) {
      if (seen.has(w.id)) {
        summary.skipped++;
        continue;
      }
      seen.add(w.id);
      const existing = await db.words.get(w.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(w)) {
          await db.words.put(w);
          summary.updated++;
        } else {
          summary.skipped++;
        }
      } else {
        await db.words.add(w);
        summary.inserted++;
      }
    }
    await db.meta.put({ key: "dataset", value: datasetTag });
  });
  return summary;
}

/** Remove bundled words that are no longer part of the bundle (e.g. a hidden level). Progress rows are kept. */
export async function pruneBundledWords(db: FlashcardDB, keepIds: Set<string>, bundledSources: ReadonlySet<string>): Promise<number> {
  const stale = (await db.words.toArray()).filter((w) => bundledSources.has(w.source) && !keepIds.has(w.id)).map((w) => w.id);
  if (stale.length) await db.words.bulkDelete(stale);
  return stale.length;
}

export async function getDatasetTag(db: FlashcardDB): Promise<string | undefined> {
  return (await db.meta.get("dataset"))?.value;
}

export async function getAllWords(db: FlashcardDB): Promise<Word[]> {
  return db.words.orderBy("frequencyRank").toArray();
}

export async function getSettings(db: FlashcardDB): Promise<Settings> {
  const s = await db.settings.get("settings");
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

export async function saveSettings(db: FlashcardDB, settings: Settings): Promise<void> {
  await db.settings.put({ ...settings, updatedAt: new Date().toISOString() });
}

// ---------- Personal lists ----------

export async function getLists(db: FlashcardDB): Promise<PersonalList[]> {
  return (await db.lists.toArray()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveList(db: FlashcardDB, list: PersonalList): Promise<void> {
  await db.lists.put({ ...list, updatedAt: new Date().toISOString() });
}

export async function deleteList(db: FlashcardDB, id: string): Promise<void> {
  await db.lists.delete(id);
}

export async function toggleInList(db: FlashcardDB, listId: string, senseId: string): Promise<boolean> {
  const list = await db.lists.get(listId);
  if (!list) return false;
  const has = list.senseIds.includes(senseId);
  const senseIds = has ? list.senseIds.filter((s) => s !== senseId) : [...list.senseIds, senseId];
  await db.lists.put({ ...list, senseIds, updatedAt: new Date().toISOString() });
  return !has;
}

// ---------- Sync metadata ----------

export async function getMeta(db: FlashcardDB, key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value;
}

export async function setMeta(db: FlashcardDB, key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}

export async function getAllStates(db: FlashcardDB): Promise<Map<string, LearningState>> {
  const rows = await db.learningStates.toArray();
  return new Map(rows.map((r) => [r.key, r]));
}

export async function getState(db: FlashcardDB, senseId: string, skill: Skill): Promise<LearningState | undefined> {
  return db.learningStates.get(stateKey(senseId, skill));
}

export async function putState(db: FlashcardDB, state: LearningState): Promise<void> {
  await db.learningStates.put(state);
}

export async function getDailyStats(db: FlashcardDB, day: string): Promise<DailyStats> {
  return (await db.dailyStats.get(day)) ?? { day, reviews: 0, newWords: 0, correct: 0, almost: 0, wrong: 0 };
}

export async function getRecentDailyStats(db: FlashcardDB, days: number): Promise<DailyStats[]> {
  const rows = await db.dailyStats.toArray();
  return rows.sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, days);
}

export type ReviewWrite = {
  session: SessionRecord;
  /** Updated learning state (absent for cloze reviews). */
  nextState?: LearningState;
  log: ReviewLogEntry;
  /** True when this review introduced a new word (first unaided review). */
  introducedNew: boolean;
  outcome: Outcome;
  now: Date;
};

/**
 * Persist one review atomically: learning state, append-only log entry,
 * session progress and daily counters all land together or not at all.
 */
export async function recordReview(db: FlashcardDB, w: ReviewWrite): Promise<void> {
  const day = localDay(w.now);
  await db.transaction("rw", db.learningStates, db.reviewLog, db.sessions, db.dailyStats, async () => {
    if (w.nextState) await db.learningStates.put(w.nextState);
    await db.reviewLog.add(w.log);
    await db.sessions.put(w.session);
    if (w.log.mode === "unaided") {
      const stats = (await db.dailyStats.get(day)) ?? {
        day,
        reviews: 0,
        newWords: 0,
        correct: 0,
        almost: 0,
        wrong: 0
      };
      stats.reviews++;
      if (w.introducedNew) stats.newWords++;
      if (w.outcome === "correct") stats.correct++;
      else if (w.outcome === "almost") stats.almost++;
      else stats.wrong++;
      await db.dailyStats.put(stats);
    }
  });
}

export async function saveSession(db: FlashcardDB, session: SessionRecord): Promise<void> {
  await db.sessions.put(session);
}

export async function getActiveSession(db: FlashcardDB): Promise<SessionRecord | undefined> {
  return db.sessions.where("status").equals("active").first();
}

export async function getReviewLog(db: FlashcardDB, limit = 500): Promise<ReviewLogEntry[]> {
  return db.reviewLog.orderBy("id").reverse().limit(limit).toArray();
}

export async function getLogForSense(db: FlashcardDB, senseId: string): Promise<ReviewLogEntry[]> {
  return db.reviewLog.where("senseId").equals(senseId).toArray();
}

export async function addReport(db: FlashcardDB, report: ContentReport): Promise<void> {
  await db.reports.add(report);
}

export async function getReports(db: FlashcardDB): Promise<ContentReport[]> {
  return db.reports.toArray();
}

export async function addCustomAnswer(db: FlashcardDB, senseId: string, skill: Skill, answer: string): Promise<void> {
  const existing = await getCustomAnswers(db, senseId, skill);
  if (existing.some((a) => a.answer.toLocaleLowerCase("de-DE") === answer.toLocaleLowerCase("de-DE"))) return;
  await db.customAnswers.add({ senseId, skill, answer, createdAt: new Date().toISOString() });
}

export async function getCustomAnswers(db: FlashcardDB, senseId: string, skill: Skill): Promise<CustomAnswer[]> {
  return db.customAnswers.where("[senseId+skill]").equals([senseId, skill]).toArray();
}

export async function getCustomAnswersForSense(db: FlashcardDB, senseId: string): Promise<CustomAnswer[]> {
  return db.customAnswers.where("senseId").equals(senseId).toArray();
}

export async function deleteCustomAnswer(db: FlashcardDB, id: number): Promise<void> {
  await db.customAnswers.delete(id);
}

// ---------- Backup / restore ----------

export type Backup = {
  format: "german-flashcards-backup";
  schemaVersion: number;
  exportedAt: string;
  words: Word[];
  learningStates: LearningState[];
  reviewLog: ReviewLogEntry[];
  sessions: SessionRecord[];
  settings: Settings;
  dailyStats: DailyStats[];
  reports: ContentReport[];
  customAnswers?: CustomAnswer[];
  lists?: PersonalList[];
};

export async function exportBackup(db: FlashcardDB, schemaVersion: number): Promise<Backup> {
  const [words, learningStates, reviewLog, sessions, settings, dailyStats, reports, customAnswers, lists] = await Promise.all([
    db.words.toArray(),
    db.learningStates.toArray(),
    db.reviewLog.toArray(),
    db.sessions.toArray(),
    getSettings(db),
    db.dailyStats.toArray(),
    db.reports.toArray(),
    db.customAnswers.toArray(),
    db.lists.toArray()
  ]);
  return {
    format: "german-flashcards-backup",
    schemaVersion,
    exportedAt: new Date().toISOString(),
    words,
    learningStates,
    reviewLog,
    sessions,
    settings,
    dailyStats,
    reports,
    customAnswers,
    lists
  };
}

/** Restore a backup, replacing progress. Vocabulary is merged by id. */
export async function importBackup(db: FlashcardDB, backup: Backup): Promise<void> {
  if (backup.format !== "german-flashcards-backup") throw new Error("Not a Wortschatz backup file.");
  await db.transaction(
    "rw",
    [db.words, db.learningStates, db.reviewLog, db.sessions, db.settings, db.dailyStats, db.reports, db.customAnswers, db.lists],
    async () => {
      await db.words.bulkPut(backup.words);
      await db.learningStates.clear();
      await db.learningStates.bulkPut(backup.learningStates);
      await db.reviewLog.clear();
      await db.reviewLog.bulkAdd(backup.reviewLog.map(({ id: _id, ...rest }) => rest));
      await db.sessions.clear();
      await db.sessions.bulkPut(backup.sessions);
      await db.settings.put({ ...DEFAULT_SETTINGS, ...backup.settings });
      await db.dailyStats.clear();
      await db.dailyStats.bulkPut(backup.dailyStats);
      await db.reports.clear();
      await db.reports.bulkAdd(backup.reports.map(({ id: _id, ...rest }) => rest));
      await db.customAnswers.clear();
      await db.customAnswers.bulkAdd((backup.customAnswers ?? []).map(({ id: _id, ...rest }) => rest));
      await db.lists.clear();
      await db.lists.bulkPut(backup.lists ?? []);
    }
  );
}

export async function resetProgress(db: FlashcardDB): Promise<void> {
  await db.transaction("rw", [db.learningStates, db.reviewLog, db.sessions, db.dailyStats], async () => {
    await db.learningStates.clear();
    await db.reviewLog.clear();
    await db.sessions.clear();
    await db.dailyStats.clear();
  });
}

/** Vocabulary as CSV (one row per sense) for export. */
export function wordsToCsv(words: Word[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "wordId",
    "senseId",
    "lemma",
    "article",
    "plural",
    "partOfSpeech",
    "cefrLevel",
    "frequencyRank",
    "englishAnswers",
    "exampleDe",
    "exampleEn",
    "source",
    "license"
  ];
  const rows = [header.join(",")];
  for (const w of words) {
    for (const s of w.senses) {
      rows.push(
        [
          w.id,
          s.id,
          w.lemma,
          w.article,
          w.plural,
          w.partOfSpeech,
          w.cefrLevel,
          w.frequencyRank,
          s.englishAnswers.join("; "),
          s.sentences[0]?.germanText,
          s.sentences[0]?.englishText,
          w.source,
          w.license
        ]
          .map(esc)
          .join(",")
      );
    }
  }
  return rows.join("\n");
}

// ---------- Learner-added words ----------

/** Add a word the learner typed in. Fails if the id (lemma + part of speech) already exists. */
export async function addUserWord(db: FlashcardDB, word: Word): Promise<void> {
  await db.transaction("rw", db.words, async () => {
    if (await db.words.get(word.id)) throw new Error(`“${word.lemma}” (${word.partOfSpeech}) is already in your vocabulary.`);
    await db.words.add(word);
  });
}

/** Remove a word with its learning states, accepted answers and list memberships. The review log is kept as history. */
export async function deleteWord(db: FlashcardDB, wordId: string): Promise<boolean> {
  return db.transaction("rw", [db.words, db.learningStates, db.customAnswers, db.lists], async () => {
    const word = await db.words.get(wordId);
    if (!word) return false;
    const senseIds = new Set(word.senses.map((s) => s.id));
    await db.words.delete(wordId);
    await db.learningStates.where("wordId").equals(wordId).delete();
    await db.customAnswers.where("senseId").anyOf([...senseIds]).delete();
    const now = new Date().toISOString();
    for (const list of await db.lists.toArray()) {
      if (list.senseIds.some((s) => senseIds.has(s))) {
        await db.lists.put({ ...list, senseIds: list.senseIds.filter((s) => !senseIds.has(s)), updatedAt: now });
      }
    }
    return true;
  });
}
