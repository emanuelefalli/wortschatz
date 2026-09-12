import type { Sentence } from "./types";

export const CLOZE_BLANK = "_____";

/** Replace the first occurrence of the target text with a blank. */
export function buildCloze(sentence: Sentence): { text: string; answer: string } {
  const idx = sentence.germanText.indexOf(sentence.targetText);
  if (idx < 0) return { text: sentence.germanText, answer: sentence.targetText };
  const text =
    sentence.germanText.slice(0, idx) + CLOZE_BLANK + sentence.germanText.slice(idx + sentence.targetText.length);
  return { text, answer: sentence.targetText };
}

/** Split a sentence into [before, target, after] for highlighting. */
export function splitHighlight(sentence: Sentence): [string, string, string] {
  const idx = sentence.germanText.indexOf(sentence.targetText);
  if (idx < 0) return [sentence.germanText, "", ""];
  return [
    sentence.germanText.slice(0, idx),
    sentence.targetText,
    sentence.germanText.slice(idx + sentence.targetText.length)
  ];
}
