// Words the learner types in by hand (Words screen → Add word). Pure helpers:
// parsing the German headword, guessing the part of speech, finding the target
// word inside an example sentence and building the Word entity. No I/O.

import type { Article, CefrLevel, PartOfSpeech, Word } from "../domain/types";
import { wordIdFor } from "./compactFormat";

export const USER_SOURCE = "user:manual";

/** True for words the learner added or imported themselves (never pruned with the bundle). */
export const isUserWord = (w: Pick<Word, "source">): boolean => w.source.startsWith("user:");

const GENDER = { der: "masculine", die: "feminine", das: "neuter" } as const;

const lc = (s: string) => s.toLocaleLowerCase("de-DE");

/** "der Tisch" → { lemma: "Tisch", article: "der" }; "laufen" → { lemma: "laufen" }. */
export function splitArticle(text: string): { lemma: string; article?: Article } {
  const t = text.trim().replace(/\s+/g, " ");
  const m = /^(der|die|das)\s+(.+)$/i.exec(t);
  if (m) return { lemma: m[2], article: lc(m[1]) as Article };
  return { lemma: t };
}

/** Best guess from the spelling alone; the learner can always override it. */
export function guessPartOfSpeech(text: string): PartOfSpeech {
  const { lemma, article } = splitArticle(text);
  if (article) return "noun";
  if (!lemma) return "other";
  if (/^sich\s/i.test(lemma)) return "verb";
  if (/^\p{Lu}/u.test(lemma)) return "noun";
  if (/(eln|ern|en)$/.test(lemma) || ["tun", "sein"].includes(lc(lemma))) return "verb";
  return "other";
}

const WORD_RE = /[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)*/gu;

/** Distinct words of a sentence, in order, as candidates for the cloze target. */
export function sentenceTokens(sentence: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of sentence.matchAll(WORD_RE)) {
    if (!seen.has(m[0])) {
      seen.add(m[0]);
      out.push(m[0]);
    }
  }
  return out;
}

/**
 * The word of the sentence that carries the headword: an exact match first,
 * then a token sharing the headword's stem (gehen → "gehe", Katze → "Katzen").
 * Undefined when nothing fits (e.g. strong verb forms like essen → "isst").
 */
export function detectTarget(sentence: string, lemma: string): string | undefined {
  const head = lemma.replace(/^sich\s+/i, "").trim();
  if (!head || !sentence.trim()) return undefined;
  if (head.includes(" ")) {
    const i = lc(sentence).indexOf(lc(head));
    return i >= 0 ? sentence.slice(i, i + head.length) : undefined;
  }
  const tokens = sentenceTokens(sentence);
  const exact = tokens.find((t) => lc(t) === lc(head));
  if (exact) return exact;
  const stem = lc(head).replace(/(eln|ern|en|n|e)$/, "");
  if (stem.length >= 3) {
    const byStem = tokens.find((t) => lc(t).startsWith(stem));
    if (byStem) return byStem;
  }
  return undefined;
}

export type UserWordInput = {
  /** German headword, optionally with its article ("der Tisch") or "sich". */
  german: string;
  /** English translations, alternatives separated by ";" (or ","). */
  english: string;
  partOfSpeech: PartOfSpeech;
  cefrLevel: CefrLevel;
  /** Required for nouns unless the article is part of `german`. */
  article?: Article | "";
  exampleDe?: string;
  exampleEn?: string;
  /** Word of the example sentence to blank out; detected when omitted. */
  target?: string;
  frequencyRank: number;
};

export function parseEnglishAnswers(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter((x) => x && !seen.has(lc(x)) && (seen.add(lc(x)), true));
}

/** Validate the form input and build the Word entity; throws a readable Error on bad input. */
export function buildUserWord(input: UserWordInput): Word {
  const parsed = splitArticle(input.german);
  let lemma = parsed.lemma;
  if (!lemma) throw new Error("Enter the German word.");
  const pos = input.partOfSpeech;
  const englishAnswers = parseEnglishAnswers(input.english);
  if (!englishAnswers.length) throw new Error("Enter the English translation.");

  const word: Word = {
    id: "",
    lemma,
    cefrLevel: input.cefrLevel,
    frequencyRank: input.frequencyRank,
    partOfSpeech: pos,
    senses: [],
    source: USER_SOURCE,
    license: "Added by the learner"
  };
  if (pos === "noun") {
    const article = input.article || parsed.article;
    if (!article) throw new Error("Choose the article (der, die or das) for a noun.");
    lemma = lemma[0].toLocaleUpperCase("de-DE") + lemma.slice(1);
    word.lemma = lemma;
    word.article = article;
    word.gender = GENDER[article];
  } else if (/^sich\s/i.test(lemma)) {
    word.lemma = "sich " + lemma.replace(/^sich\s+/i, "");
    if (pos === "verb") word.verbForms = { reflexive: true };
  }
  word.id = wordIdFor(word.lemma, pos);

  const senseId = `${word.id}:1`;
  const exampleDe = (input.exampleDe ?? "").trim().replace(/\s+/g, " ");
  const sentences: Word["senses"][number]["sentences"] = [];
  if (exampleDe) {
    const target = (input.target ?? "").trim() || detectTarget(exampleDe, word.lemma);
    if (!target) throw new Error("Pick which word of the example sentence is the one you are learning.");
    if (!exampleDe.includes(target)) throw new Error(`"${target}" does not occur in the example sentence.`);
    if (exampleDe === target) throw new Error("The example sentence must contain more than the word itself.");
    sentences.push({
      id: `${senseId}:1`,
      senseId,
      germanText: exampleDe,
      englishText: (input.exampleEn ?? "").trim(),
      cefrLevel: input.cefrLevel,
      targetText: target,
      source: USER_SOURCE
    });
  }
  word.senses.push({ id: senseId, wordId: word.id, order: 1, englishAnswers, sentences });
  return word;
}

/** An existing word that would clash: the same id, or the same headword with another part of speech. */
export function findExistingWord(words: readonly Word[], lemma: string, pos: PartOfSpeech): { word: Word; exact: boolean } | undefined {
  if (!lemma) return undefined;
  const norm = (s: string) => lc(s).replace(/^sich\s+/, "");
  const id = wordIdFor(pos === "noun" ? lemma[0].toLocaleUpperCase("de-DE") + lemma.slice(1) : lemma, pos);
  const exact = words.find((w) => w.id === id);
  if (exact) return { word: exact, exact: true };
  const similar = words.find((w) => norm(w.lemma) === norm(lemma));
  return similar ? { word: similar, exact: false } : undefined;
}
