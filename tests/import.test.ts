import { beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { parseCsv, parseVocabularyCsv } from "../src/data/csv";
import { validateWords } from "../src/data/validate";
import { createTestDB, SCHEMA_VERSION, type FlashcardDB } from "../src/db/schema";
import { addCustomAnswer, exportBackup, getCustomAnswers, importBackup, importWords } from "../src/db/repo";
import { gradeAnswer } from "../src/domain/grader";
import { WORDS, firstSense } from "./fixtures";

const CSV = `lemma,partOfSpeech,cefrLevel,englishAnswers,article,plural,exampleDe,exampleEn,target,thirdPersonPresent,preterite,pastParticiple,auxiliary,usageNote
Tisch,noun,A1,table,der,Tische,"Das Buch liegt auf dem Tisch.",The book is on the table.,,,,,,
laufen,verb,A1,to run,,,Er läuft im Park.,He runs in the park.,läuft,läuft,lief,gelaufen,sein,
laufen,verb,A1,to run; to operate,,,Der Motor läuft noch.,The engine is still running.,läuft,,,,,
"Straße",noun,A1,"street; road",die,Straßen,"Die Straße ist leer, aber laut.","The street is empty, but loud.",,,,,,
`;

describe("CSV parsing", () => {
  it("handles quoted fields, embedded commas and doubled quotes", () => {
    const rows = parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n');
    expect(rows).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"]
    ]);
  });
  it("builds words, merges senses and derives stable ids", () => {
    const words = parseVocabularyCsv(CSV, { source: "test", license: "CC0" });
    expect(words.map((w) => w.id)).toEqual(["w:tisch:noun", "w:laufen:verb", "w:strasse:noun"]);
    const laufen = words[1];
    expect(laufen.senses.length).toBe(2);
    expect(laufen.senses[1].englishAnswers).toEqual(["to run", "to operate"]);
    expect(laufen.verbForms).toMatchObject({ preterite: "lief", auxiliary: "sein" });
    expect(words[0]).toMatchObject({ article: "der", gender: "masculine", plural: "Tische" });
    expect(words[0].senses[0].sentences[0].targetText).toBe("Tisch");
    expect(validateWords(words)).toEqual([]);
  });
  it("rejects missing required columns and bad rows", () => {
    expect(() => parseVocabularyCsv("lemma,partOfSpeech\nx,noun\n", { source: "t" })).toThrow(/missing the required column/);
    expect(() => parseVocabularyCsv("lemma,partOfSpeech,cefrLevel,englishAnswers\nx,adjective,Z9,y\n", { source: "t" })).toThrow(/CEFR/);
    expect(() =>
      parseVocabularyCsv("lemma,partOfSpeech,cefrLevel,englishAnswers,exampleDe,exampleEn,target\nHaus,noun,A1,house,Wir wohnen hier.,We live here.,Haus\n", { source: "t" })
    ).toThrow(/does not occur/);
  });
});

describe("validateWords", () => {
  it("accepts the bundled dataset", () => {
    expect(validateWords(WORDS).filter((p) => p.severity === "error")).toEqual([]);
  });
  it("flags nouns without articles, duplicate lemmas and missing sentences", () => {
    const [w] = firstSense("Tisch");
    const broken = { ...w, article: undefined, senses: [{ ...w.senses[0], sentences: [] }] };
    const problems = validateWords([broken, { ...w, id: "other" }]);
    const messages = problems.map((p) => p.message);
    expect(messages).toContain("noun without article");
    expect(messages).toContain("duplicate lemma + part of speech");
    expect(messages.some((m) => m.startsWith("no example sentence"))).toBe(true);
  });
});

describe("schema migration v1 → v2", () => {
  let name: string;
  beforeEach(() => {
    name = `migrate-${Date.now()}-${Math.random()}`;
  });

  it("keeps existing data and adds the customAnswers table", async () => {
    // Create a database with the v1 schema and some data.
    const v1 = new Dexie(name);
    v1.version(1).stores({
      words: "id, lemma, cefrLevel, partOfSpeech, frequencyRank",
      learningStates: "key, senseId, wordId, skill, dueAt, phase",
      reviewLog: "++id, senseId, skill, reviewedAt, sessionId, [senseId+skill]",
      sessions: "id, status, startedAt",
      settings: "id",
      dailyStats: "day",
      reports: "++id, createdAt, senseId",
      meta: "key"
    });
    await v1.table("words").put(WORDS[0]);
    await v1.table("settings").put({ id: "settings", schemaVersion: 1, dailyNewWordLimit: 4 });
    await v1.table("reviewLog").add({ senseId: "s", skill: "de_en", reviewedAt: "2026-01-01T00:00:00Z", sessionId: "x" });
    v1.close();

    const db: FlashcardDB = createTestDB(name);
    await db.open();
    expect(db.verno).toBe(SCHEMA_VERSION);
    expect(await db.words.count()).toBe(1);
    expect(await db.reviewLog.count()).toBe(1);
    expect((await db.settings.get("settings"))?.schemaVersion).toBe(SCHEMA_VERSION);
    expect((await db.settings.get("settings"))?.dailyNewWordLimit).toBe(4);
    await addCustomAnswer(db, "s1", "de_en", "to phone");
    expect((await getCustomAnswers(db, "s1", "de_en")).map((a) => a.answer)).toEqual(["to phone"]);
  });
});

describe("custom accepted answers", () => {
  it("are used by the grader and survive a backup round-trip", async () => {
    const db = createTestDB(`custom-${Date.now()}`);
    await importWords(db, WORDS, "t");
    const [anrufen, sense] = firstSense("anrufen");
    expect(gradeAnswer(anrufen, sense, "de_en", "to ring").outcome).toBe("wrong");
    await addCustomAnswer(db, sense.id, "de_en", "to ring");
    await addCustomAnswer(db, sense.id, "de_en", "To Ring"); // de-duplicated case-insensitively
    const extra = (await getCustomAnswers(db, sense.id, "de_en")).map((a) => a.answer);
    expect(extra).toEqual(["to ring"]);
    expect(gradeAnswer(anrufen, sense, "de_en", "ring", { umlautTolerance: "almost", requireArticle: true, extraAccepted: extra }).outcome).toBe("correct");

    // EN→DE custom answers: the article is stripped and re-checked.
    const [tisch, tischSense] = firstSense("Tisch");
    const r = gradeAnswer(tisch, tischSense, "en_de", "die Tafel", { umlautTolerance: "almost", requireArticle: true, extraAccepted: ["die Tafel"] });
    expect(r.outcome).toBe("almost"); // "Tafel" accepted, but the article for Tisch is "der"
    expect(gradeAnswer(tisch, tischSense, "en_de", "der Tafel", { umlautTolerance: "almost", requireArticle: true, extraAccepted: ["die Tafel"] }).outcome).toBe("correct");

    const backup = await exportBackup(db, SCHEMA_VERSION);
    expect(backup.customAnswers?.length).toBe(1);
    const db2 = createTestDB(`custom2-${Date.now()}`);
    await importBackup(db2, JSON.parse(JSON.stringify(backup)));
    expect((await getCustomAnswers(db2, sense.id, "de_en")).length).toBe(1);
  });
});
