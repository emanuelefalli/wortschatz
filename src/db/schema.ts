// IndexedDB schema via Dexie. Bump SCHEMA_VERSION and add a .version() block
// with an upgrade() function for any change to stored shapes.

import Dexie, { type EntityTable } from "dexie";
import type {
  ContentReport,
  CustomAnswer,
  DailyStats,
  LearningState,
  PersonalList,
  ReviewLogEntry,
  SessionRecord,
  Settings,
  Word
} from "../domain/types";

export type MetaRow = { key: string; value: string };

export const SCHEMA_VERSION = 3;

export class FlashcardDB extends Dexie {
  words!: EntityTable<Word, "id">;
  learningStates!: EntityTable<LearningState, "key">;
  reviewLog!: EntityTable<ReviewLogEntry, "id">;
  sessions!: EntityTable<SessionRecord, "id">;
  settings!: EntityTable<Settings, "id">;
  dailyStats!: EntityTable<DailyStats, "day">;
  reports!: EntityTable<ContentReport, "id">;
  meta!: EntityTable<MetaRow, "key">;
  customAnswers!: EntityTable<CustomAnswer, "id">;
  lists!: EntityTable<PersonalList, "id">;

  constructor(name = "german-flashcards") {
    super(name);
    this.version(1).stores({
      words: "id, lemma, cefrLevel, partOfSpeech, frequencyRank",
      learningStates: "key, senseId, wordId, skill, dueAt, phase",
      reviewLog: "++id, senseId, skill, reviewedAt, sessionId, [senseId+skill]",
      sessions: "id, status, startedAt",
      settings: "id",
      dailyStats: "day",
      reports: "++id, createdAt, senseId",
      meta: "key"
    });
    // v2: learner-accepted translations. Existing tables are carried over unchanged.
    this.version(2)
      .stores({
        customAnswers: "++id, senseId, [senseId+skill]"
      })
      .upgrade(async (tx) => {
        const settings = await tx.table("settings").get("settings");
        if (settings) await tx.table("settings").put({ ...settings, schemaVersion: 2 });
      });
    // v3: personal vocabulary lists; settings carry updatedAt for sync.
    this.version(3)
      .stores({
        lists: "id, name, updatedAt"
      })
      .upgrade(async (tx) => {
        const settings = await tx.table("settings").get("settings");
        if (settings) await tx.table("settings").put({ ...settings, schemaVersion: 3, updatedAt: settings.updatedAt ?? new Date(0).toISOString() });
      });
  }
}

let instance: FlashcardDB | null = null;

export function getDB(): FlashcardDB {
  if (!instance) instance = new FlashcardDB();
  return instance;
}

/** For tests: use a fresh, isolated database. */
export function createTestDB(name: string): FlashcardDB {
  return new FlashcardDB(name);
}
