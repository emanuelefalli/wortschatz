import dataset from "../data/vocab/sample-a1a2.json";
import { expandDataset, type CompactDataset } from "../src/data/compactFormat";
import type { Word, WordSense } from "../src/domain/types";

export const WORDS: Word[] = expandDataset(dataset as CompactDataset);

export function findWord(lemma: string, pos?: string): Word {
  const w = WORDS.find((x) => x.lemma === lemma && (!pos || x.partOfSpeech === pos));
  if (!w) throw new Error(`fixture word not found: ${lemma}`);
  return w;
}

export function firstSense(lemma: string, pos?: string): [Word, WordSense] {
  const w = findWord(lemma, pos);
  return [w, w.senses[0]];
}
