// Content validation shared by the test-suite, the import UI and the CLI
// script. Returns human-readable problems; an empty list means the dataset
// is acceptable for production use.

import type { Word } from "../domain/types";
import { CEFR_LEVELS } from "../domain/types.ts";

export type Problem = { severity: "error" | "warning"; where: string; message: string };

const MAX_SENTENCE_WORDS: Record<string, number> = { A1: 12, A2: 16, B1: 20, B2: 26, C1: 32, C2: 40 };

export function validateWords(words: Word[]): Problem[] {
  const problems: Problem[] = [];
  const err = (where: string, message: string) => problems.push({ severity: "error", where, message });
  const warn = (where: string, message: string) => problems.push({ severity: "warning", where, message });
  const ids = new Set<string>();
  const lemmaPos = new Set<string>();

  for (const w of words) {
    const where = `${w.lemma} (${w.partOfSpeech})`;
    if (ids.has(w.id)) err(where, `duplicate word id ${w.id}`);
    ids.add(w.id);
    const lp = `${w.lemma.toLocaleLowerCase("de-DE")}|${w.partOfSpeech}`;
    if (lemmaPos.has(lp)) err(where, "duplicate lemma + part of speech");
    lemmaPos.add(lp);
    if (!CEFR_LEVELS.includes(w.cefrLevel)) err(where, `invalid CEFR level ${w.cefrLevel}`);
    if (!w.source) err(where, "missing source");
    if (!w.license) warn(where, "missing license");
    if (w.partOfSpeech === "noun") {
      if (!w.article) err(where, "noun without article");
      if (w.lemma[0] !== w.lemma[0].toLocaleUpperCase("de-DE")) err(where, "noun lemma must be capitalized");
    }
    if (w.partOfSpeech === "verb" && !w.verbForms?.pastParticiple) warn(where, "verb without past participle");
    if (!w.senses.length) err(where, "no senses");
    const orders = new Set<number>();
    for (const s of w.senses) {
      const sw = `${where} sense ${s.order}`;
      if (ids.has(s.id)) err(sw, `duplicate sense id ${s.id}`);
      ids.add(s.id);
      if (orders.has(s.order)) err(sw, "duplicate sense order");
      orders.add(s.order);
      if (!s.englishAnswers.length) err(sw, "no English answers");
      if (s.englishAnswers.some((a) => !a.trim())) err(sw, "empty English answer");
      if (!s.sentences.length) err(sw, "no example sentence (context is mandatory for new and failed words)");
      for (const x of s.sentences) {
        const xw = `${sw} sentence "${x.germanText}"`;
        if (ids.has(x.id)) err(xw, `duplicate sentence id ${x.id}`);
        ids.add(x.id);
        if (!x.germanText.includes(x.targetText)) err(xw, `target "${x.targetText}" not in sentence`);
        if (!x.englishText.trim()) err(xw, "missing English translation");
        if (x.germanText.trim() === x.targetText) err(xw, "sentence is just the target word");
        const n = x.germanText.split(/\s+/).length;
        const max = MAX_SENTENCE_WORDS[x.cefrLevel] ?? 40;
        if (n > max) warn(xw, `${n} words is long for ${x.cefrLevel} (max ${max})`);
        if (!x.source) err(xw, "missing sentence source");
      }
    }
  }
  return problems;
}
