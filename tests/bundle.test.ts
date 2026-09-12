import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { loadBundledWords, BUNDLED_DATASETS } from "../src/data/loader";
import { expandDataset, type CompactDataset } from "../src/data/compactFormat";
import { validateWords } from "../src/data/validate";

const key = (lemma: string) => lemma.toLocaleLowerCase("de-DE").replace(/^sich /, "");

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

  it("orders files from easy to hard and keeps per-file ranks", () => {
    const words = loadBundledWords();
    expect(words[0].cefrLevel).toBe("A1");
    for (let i = 1; i < words.length; i++) expect(words[i].frequencyRank).toBeGreaterThan(words[i - 1].frequencyRank);
  });

  it("the personal DTZ file, when present, does not overlap the bundled words", () => {
    const path = "data/personal/dtz-a2b1.json";
    if (!existsSync(path)) return;
    const personal = expandDataset(JSON.parse(readFileSync(path, "utf8")) as CompactDataset);
    const bundled = new Set(loadBundledWords().map((w) => key(w.lemma)));
    const overlap = personal.filter((w) => bundled.has(key(w.lemma))).map((w) => w.lemma);
    expect(overlap).toEqual([]);
    expect(validateWords([...loadBundledWords(), ...personal]).filter((p) => p.severity === "error")).toEqual([]);
  });
});
