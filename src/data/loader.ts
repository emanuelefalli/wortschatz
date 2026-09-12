import type { CompactDataset } from "./compactFormat";
import { expandDataset } from "./compactFormat";
import type { CefrLevel, Word } from "../domain/types";
import { parseVocabularyCsv } from "./csv";

// Every JSON file in data/vocab is bundled. Add a file there to extend the
// vocabulary; ids are derived from lemma + part of speech, so files must not
// overlap.
const files = import.meta.glob<CompactDataset>("../../data/vocab/*.json", { eager: true, import: "default" });

const LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** Typical level of a dataset = the most common entry level; used to order files from easy to hard. */
function datasetLevel(d: CompactDataset): number {
  const counts = new Map<string, number>();
  for (const e of d.entries) counts.set(e.c, (counts.get(e.c) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "C2";
  return LEVEL_ORDER.indexOf(top);
}

// Easier datasets first so frequency ranks (and thus new-word order) go from A1 upwards.
export const BUNDLED_DATASETS: CompactDataset[] = Object.keys(files)
  .sort()
  .map((k) => files[k])
  .sort((a, b) => datasetLevel(a) - datasetLevel(b));

/** Levels the learner asked to leave out of the app entirely (the words stay in the data files). */
export const HIDDEN_LEVELS: ReadonlySet<CefrLevel> = new Set<CefrLevel>(["A1"]);

export const BUNDLED_DATASET_TAG = BUNDLED_DATASETS.map((d) => `${d.meta.source}@${d.entries.length}`).join("+") + `|hidden=${[...HIDDEN_LEVELS].join(",")}`;

/** Sources of bundled datasets, used to prune words that were removed from the bundle. */
export const BUNDLED_SOURCES: ReadonlySet<string> = new Set(BUNDLED_DATASETS.map((d) => d.meta.source));

export function loadBundledWords(): Word[] {
  // Within a file, honour explicit ranks (or file order); across files, easy datasets first.
  const words = BUNDLED_DATASETS.flatMap((d) => expandDataset(d).sort((a, b) => a.frequencyRank - b.frequencyRank)).filter((w) => !HIDDEN_LEVELS.has(w.cefrLevel));
  const seen = new Set<string>();
  for (const w of words) {
    if (seen.has(w.id)) throw new Error(`Bundled datasets overlap on ${w.id}`);
    seen.add(w.id);
  }
  // Rank across files: keep file order, then position.
  return words.map((w, i) => ({ ...w, frequencyRank: i + 1 }));
}

/** Parse a user-supplied JSON file: either compact format or a plain Word[] export. */
export function parseVocabularyJson(text: string): Word[] {
  const data = JSON.parse(text) as unknown;
  if (Array.isArray(data)) return data as Word[];
  if (data && typeof data === "object" && "entries" in data) return expandDataset(data as CompactDataset);
  if (data && typeof data === "object" && "words" in data) return (data as { words: Word[] }).words;
  throw new Error("Unrecognized vocabulary file.");
}

/** Parse by file name: .csv or .json. */
export function parseVocabularyFile(name: string, text: string): Word[] {
  if (/\.csv$/i.test(name)) return parseVocabularyCsv(text, { source: `user:${name}` });
  return parseVocabularyJson(text);
}
