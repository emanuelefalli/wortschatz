// CSV vocabulary import (spec §2 option 3: the learner imports a legally
// obtained file). One row per sense; rows with the same lemma + part of speech
// are merged into one word with several senses.

import type { Article, CefrLevel, PartOfSpeech, Word } from "../domain/types";
import { CEFR_LEVELS } from "../domain/types";
import { wordIdFor } from "./compactFormat";

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF/LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

export const CSV_COLUMNS = [
  "lemma",
  "partOfSpeech",
  "cefrLevel",
  "englishAnswers",
  "article",
  "plural",
  "exampleDe",
  "exampleEn",
  "target",
  "thirdPersonPresent",
  "preterite",
  "pastParticiple",
  "auxiliary",
  "grammarNote",
  "usageNote",
  "source",
  "license",
  "frequencyRank"
] as const;

const POS: PartOfSpeech[] = ["noun", "verb", "adjective", "adverb", "preposition", "pronoun", "conjunction", "numeral", "interjection", "particle", "other"];

/**
 * Parse a CSV file into words. Required columns: lemma, partOfSpeech,
 * cefrLevel, englishAnswers (separated by ";"). Optional columns as in
 * CSV_COLUMNS; unknown columns are ignored. The export produced by the app is
 * accepted too (wordId/senseId columns are ignored, ids are re-derived).
 */
export function parseVocabularyCsv(text: string, defaults: { source: string; license?: string }): Word[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSV has no data rows.");
  const header = rows[0].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  for (const req of ["lemma", "partOfSpeech", "cefrLevel", "englishAnswers"]) {
    if (col(req) < 0) throw new Error(`CSV is missing the required column "${req}".`);
  }
  const get = (r: string[], name: string) => {
    const i = col(name);
    return i >= 0 ? (r[i] ?? "").trim() : "";
  };

  const words = new Map<string, Word>();
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const lemma = get(r, "lemma");
    const pos = get(r, "partOfSpeech") as PartOfSpeech;
    const level = get(r, "cefrLevel") as CefrLevel;
    if (!lemma) throw new Error(`Line ${line}: empty lemma.`);
    if (!POS.includes(pos)) throw new Error(`Line ${line}: unknown part of speech "${pos}".`);
    if (!CEFR_LEVELS.includes(level)) throw new Error(`Line ${line}: unknown CEFR level "${level}".`);
    const english = get(r, "englishAnswers")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean);
    if (!english.length) throw new Error(`Line ${line}: no English answers.`);

    const id = wordIdFor(lemma, pos);
    let word = words.get(id);
    if (!word) {
      const article = get(r, "article") as Article | "";
      const rank = Number(get(r, "frequencyRank"));
      word = {
        id,
        lemma,
        cefrLevel: level,
        frequencyRank: Number.isFinite(rank) && rank > 0 ? rank : 100000 + idx,
        partOfSpeech: pos,
        senses: [],
        source: get(r, "source") || defaults.source,
        license: get(r, "license") || defaults.license
      };
      if (article) {
        if (!["der", "die", "das"].includes(article)) throw new Error(`Line ${line}: article must be der/die/das.`);
        word.article = article;
        word.gender = article === "der" ? "masculine" : article === "die" ? "feminine" : "neuter";
      }
      if (get(r, "plural")) word.plural = get(r, "plural");
      const p3 = get(r, "thirdPersonPresent");
      const pret = get(r, "preterite");
      const pp = get(r, "pastParticiple");
      const aux = get(r, "auxiliary");
      if (p3 || pret || pp) {
        word.verbForms = {
          thirdPersonPresent: p3 || undefined,
          preterite: pret || undefined,
          pastParticiple: pp || undefined,
          auxiliary: aux === "sein" ? "sein" : aux === "haben" ? "haben" : undefined
        };
      }
      words.set(id, word);
    }

    const senseId = `${id}:${word.senses.length + 1}`;
    const de = get(r, "exampleDe");
    const en = get(r, "exampleEn");
    const target = get(r, "target") || lemma;
    const sentences = [];
    if (de) {
      if (!de.includes(target)) throw new Error(`Line ${line}: target "${target}" does not occur in the example sentence.`);
      sentences.push({
        id: `${senseId}:1`,
        senseId,
        germanText: de,
        englishText: en,
        cefrLevel: level,
        targetText: target,
        source: word.source,
        license: word.license
      });
    }
    word.senses.push({
      id: senseId,
      wordId: id,
      order: word.senses.length + 1,
      englishAnswers: english,
      grammarNote: get(r, "grammarNote") || undefined,
      usageNote: get(r, "usageNote") || undefined,
      sentences
    });
  });
  return [...words.values()];
}
