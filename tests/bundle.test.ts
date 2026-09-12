import { describe, expect, it } from "vitest";
import { loadBundledWords, BUNDLED_DATASETS } from "../src/data/loader";
import { validateWords } from "../src/data/validate";


describe("bundled vocabulary", () => {
  it("has no duplicate lemmas across files and validates cleanly", () => {
    const words = loadBundledWords();
    const seen = new Map<string, string>();
    for (const w of words) {
      const k = `${w.lemma}|${w.partOfSpeech}`; // "morgen" (adverb) and "Morgen" (noun) are different words
      expect(seen.has(k), `duplicate lemma "${w.lemma}" (${w.id} vs ${seen.get(k)})`).toBe(false);
      seen.set(k, w.id);
    }
    expect(validateWords(words).filter((p) => p.severity === "error")).toEqual([]);
    expect(BUNDLED_DATASETS.length).toBeGreaterThanOrEqual(2);
  });

  it("hides A1, orders files from easy to hard and keeps per-file ranks", () => {
    const words = loadBundledWords();
    expect(words.some((w) => w.cefrLevel === "A1")).toBe(false);
    expect(words[0].cefrLevel).toBe("A2");
    for (let i = 1; i < words.length; i++) expect(words[i].frequencyRank).toBeGreaterThan(words[i - 1].frequencyRank);
  });
});
