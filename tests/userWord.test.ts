import { describe, expect, it } from "vitest";
import { buildUserWord, detectTarget, findExistingWord, guessPartOfSpeech, parseEnglishAnswers, splitArticle } from "../src/data/userWord";
import { validateWords } from "../src/data/validate";
import { createTestDB } from "../src/db/schema";
import { addCustomAnswer, addUserWord, deleteWord, getAllWords, getCustomAnswersForSense, importWords, putState, saveList, getLists } from "../src/db/repo";
import { applyAnswer, buildSession, currentItem } from "../src/domain/session";
import { newLearningState } from "../src/domain/scheduler";
import { gradeAnswer } from "../src/domain/grader";
import { DEFAULT_SETTINGS } from "../src/domain/types";
import { WORDS } from "./fixtures";

describe("manual word entry", () => {
  it("parses articles and guesses the part of speech", () => {
    expect(splitArticle("  der   Tisch ")).toEqual({ lemma: "Tisch", article: "der" });
    expect(splitArticle("Die Katze")).toEqual({ lemma: "Katze", article: "die" });
    expect(splitArticle("laufen")).toEqual({ lemma: "laufen" });
    expect(guessPartOfSpeech("das Haus")).toBe("noun");
    expect(guessPartOfSpeech("Haus")).toBe("noun");
    expect(guessPartOfSpeech("sich freuen")).toBe("verb");
    expect(guessPartOfSpeech("sammeln")).toBe("verb");
    expect(guessPartOfSpeech("schnell")).toBe("other");
    expect(parseEnglishAnswers("table; desk , Table")).toEqual(["table", "desk"]);
  });

  it("finds the target word in an example sentence", () => {
    expect(detectTarget("Das Buch liegt auf dem Tisch.", "Tisch")).toBe("Tisch");
    expect(detectTarget("Ich gehe heute ins Kino.", "gehen")).toBe("gehe");
    expect(detectTarget("Die Katzen schlafen.", "Katze")).toBe("Katzen");
    expect(detectTarget("Ich freue mich auf dich.", "sich freuen")).toBe("freue");
    expect(detectTarget("Ab und zu regnet es.", "ab und zu")).toBe("Ab und zu");
    expect(detectTarget("Er isst gern Pizza.", "essen")).toBeUndefined();
  });

  it("builds a valid noun with sentence, and a verb without one", () => {
    const tisch = buildUserWord({ german: "der tisch", english: "table; desk", partOfSpeech: "noun", cefrLevel: "A2", exampleDe: "Das Buch liegt auf dem Tisch.", exampleEn: "The book is on the table.", frequencyRank: 5000 });
    expect(tisch).toMatchObject({ id: "w:tisch:noun", lemma: "Tisch", article: "der", gender: "masculine", source: "user:manual" });
    expect(tisch.senses[0].englishAnswers).toEqual(["table", "desk"]);
    expect(tisch.senses[0].sentences[0]).toMatchObject({ targetText: "Tisch", englishText: "The book is on the table." });
    expect(validateWords([tisch]).filter((p) => p.severity === "error")).toEqual([]);

    const v = buildUserWord({ german: "sich beeilen", english: "to hurry", partOfSpeech: "verb", cefrLevel: "B1", frequencyRank: 5001 });
    expect(v).toMatchObject({ id: "w:sich-beeilen:verb", lemma: "sich beeilen", verbForms: { reflexive: true } });
    expect(v.senses[0].sentences).toEqual([]);
    expect(gradeAnswer(v, v.senses[0], "de_en", "to hurry").outcome).toBe("correct");
  });

  it("rejects incomplete input", () => {
    expect(() => buildUserWord({ german: "", english: "x", partOfSpeech: "other", cefrLevel: "A2", frequencyRank: 1 })).toThrow(/German word/);
    expect(() => buildUserWord({ german: "Haus", english: " ", partOfSpeech: "noun", cefrLevel: "A2", article: "das", frequencyRank: 1 })).toThrow(/English/);
    expect(() => buildUserWord({ german: "Haus", english: "house", partOfSpeech: "noun", cefrLevel: "A2", frequencyRank: 1 })).toThrow(/article/);
    expect(() => buildUserWord({ german: "essen", english: "to eat", partOfSpeech: "verb", cefrLevel: "A2", exampleDe: "Er isst gern Pizza.", frequencyRank: 1 })).toThrow(/Pick which word/);
    expect(buildUserWord({ german: "essen", english: "to eat", partOfSpeech: "verb", cefrLevel: "A2", exampleDe: "Er isst gern Pizza.", target: "isst", frequencyRank: 1 }).senses[0].sentences[0].targetText).toBe("isst");
  });

  it("detects duplicates against the existing vocabulary", () => {
    expect(findExistingWord(WORDS, "tisch", "noun")?.exact).toBe(true);
    expect(findExistingWord(WORDS, "Tisch", "verb")).toMatchObject({ exact: false, word: { id: "w:tisch:noun" } });
    expect(findExistingWord(WORDS, "Zzzz", "noun")).toBeUndefined();
  });

  it("stores, refuses duplicates, and deletes with its progress", async () => {
    const db = createTestDB(`user-word-${Date.now()}`);
    await importWords(db, WORDS, "t");
    const w = buildUserWord({ german: "die Ampel", english: "traffic light", partOfSpeech: "noun", cefrLevel: "A2", frequencyRank: 9000 });
    await addUserWord(db, w);
    await expect(addUserWord(db, w)).rejects.toThrow(/already/);
    expect((await getAllWords(db)).some((x) => x.id === w.id)).toBe(true);

    await putState(db, newLearningState(w.id, w.senses[0].id, "de_en", new Date()));
    await addCustomAnswer(db, w.senses[0].id, "de_en", "traffic lights");
    await saveList(db, { id: "l1", name: "Traffic", senseIds: [w.senses[0].id, "other"], createdAt: "", updatedAt: "" });
    expect(await deleteWord(db, w.id)).toBe(true);
    expect((await getAllWords(db)).some((x) => x.id === w.id)).toBe(false);
    expect(await db.learningStates.where("wordId").equals(w.id).count()).toBe(0);
    expect(await getCustomAnswersForSense(db, w.senses[0].id)).toEqual([]);
    expect((await getLists(db))[0].senseIds).toEqual(["other"]);
    expect(await deleteWord(db, w.id)).toBe(false);
  });

  it("skips the cloze step for a failed word that has no example sentence", () => {
    const v = buildUserWord({ german: "sich beeilen", english: "to hurry", partOfSpeech: "verb", cefrLevel: "A2", frequencyRank: 5001 });
    const s = buildSession({
      words: [v],
      states: new Map(),
      config: { direction: "de_en", levels: ["A2"], cardCount: 5, newWordLimit: 5, filter: "all" },
      settings: DEFAULT_SETTINGS,
      now: new Date("2026-03-10T09:00:00Z"),
      newWordsToday: 0,
      sessionId: "u1"
    });
    const item = currentItem(s)!;
    const after = applyAnswer(s, item, "wrong", undefined);
    expect(after.queue.map((q) => q.mode)).toEqual(["unaided", "unaided"]);
    expect(after.queue[1].retry).toBe(true);
  });
});
