import { describe, expect, it } from "vitest";
import dataset from "../data/vocab/sample-a1a2.json";
import { expandDataset, type CompactDataset } from "../src/data/compactFormat";
import { WORDS } from "./fixtures";

describe("bundled dataset", () => {
  it("has 100–300 A1/A2 entries with a recorded source and license", () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(100);
    expect(WORDS.length).toBeLessThanOrEqual(300);
    for (const w of WORDS) {
      expect(["A1", "A2"]).toContain(w.cefrLevel);
      expect(w.source).toBeTruthy();
      expect(w.license).toBeTruthy();
      for (const s of w.senses) for (const x of s.sentences) expect(x.source).toBeTruthy();
    }
  });
  it("has unique word, sense and sentence ids", () => {
    const ids = new Set<string>();
    for (const w of WORDS) {
      expect(ids.has(w.id)).toBe(false);
      ids.add(w.id);
      for (const s of w.senses) {
        expect(ids.has(s.id)).toBe(false);
        ids.add(s.id);
        for (const x of s.sentences) {
          expect(ids.has(x.id)).toBe(false);
          ids.add(x.id);
        }
      }
    }
  });
  it("every sense has at least one bilingual sentence whose target occurs in the German text", () => {
    for (const w of WORDS) {
      for (const s of w.senses) {
        expect(s.sentences.length).toBeGreaterThan(0);
        expect(s.englishAnswers.length).toBeGreaterThan(0);
        for (const x of s.sentences) {
          expect(x.germanText).toContain(x.targetText);
          expect(x.englishText.length).toBeGreaterThan(0);
          // The sentence must not simply be the headword (would leak the answer format).
          expect(x.germanText.trim()).not.toBe(x.targetText);
        }
      }
    }
  });
  it("nouns carry article, gender and capitalization; verbs carry principal parts", () => {
    for (const w of WORDS) {
      if (w.partOfSpeech === "noun") {
        expect(w.article).toBeTruthy();
        expect(w.gender).toBeTruthy();
        expect(w.lemma[0]).toBe(w.lemma[0].toUpperCase());
      }
      if (w.partOfSpeech === "verb") {
        expect(w.verbForms?.thirdPersonPresent).toBeTruthy();
        expect(w.verbForms?.preterite).toBeTruthy();
        expect(w.verbForms?.pastParticiple).toBeTruthy();
        expect(["haben", "sein"]).toContain(w.verbForms?.auxiliary);
      }
    }
  });
  it("rejects duplicate entries and unknown formats", () => {
    const d = dataset as CompactDataset;
    expect(() => expandDataset({ ...d, entries: [d.entries[0], d.entries[0]] })).toThrow(/Duplicate/);
    expect(() => expandDataset({ ...d, meta: { ...d.meta, format: "x" as "compact-v1" } })).toThrow(/Unsupported/);
  });
  it("assigns stable ids across re-expansion", () => {
    const again = expandDataset(dataset as CompactDataset);
    expect(again.map((w) => w.id)).toEqual(WORDS.map((w) => w.id));
  });
});
