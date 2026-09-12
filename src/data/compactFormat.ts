// Converts the compact authoring format in data/vocab/*.json into the domain
// entities. Ids are derived deterministically from lemma + part of speech so
// re-importing the same file never creates duplicate cards.

import type {
  Article,
  CefrLevel,
  Gender,
  PartOfSpeech,
  Sentence,
  Word,
  WordSense
} from "../domain/types";

export type CompactSentence = [de: string, en: string, target: string, note?: string];

export type CompactSense = {
  en: string[];
  de?: string[];
  reg?: string;
  gn?: string;
  un?: string;
  x: CompactSentence[];
};

export type CompactEntry = {
  l: string;
  p: PartOfSpeech;
  c: CefrLevel;
  rank?: number;
  art?: Article;
  pl?: string;
  gen?: string;
  v?: {
    p3?: string;
    pret?: string;
    pp?: string;
    aux?: "haben" | "sein";
    sep?: boolean;
    refl?: boolean;
    prep?: string;
  };
  adj?: { comp?: string; sup?: string };
  case?: string;
  s: CompactSense[];
};

export type CompactDataset = {
  meta: { name: string; source: string; license?: string; notes?: string; format: "compact-v1" };
  entries: CompactEntry[];
};

const GENDER_BY_ARTICLE: Record<Article, Gender> = {
  der: "masculine",
  die: "feminine",
  das: "neuter"
};

/** Stable, URL-safe id fragment from a lemma. */
export function slug(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function wordIdFor(lemma: string, pos: PartOfSpeech): string {
  return `w:${slug(lemma)}:${pos}`;
}

export function expandDataset(data: CompactDataset): Word[] {
  if (data.meta.format !== "compact-v1") {
    throw new Error(`Unsupported dataset format: ${String(data.meta.format)}`);
  }
  const seen = new Set<string>();
  return data.entries.map((e, index) => {
    const id = wordIdFor(e.l, e.p);
    if (seen.has(id)) throw new Error(`Duplicate entry in dataset: ${e.l} (${e.p})`);
    seen.add(id);

    const senses: WordSense[] = e.s.map((s, si) => {
      const senseId = `${id}:${si + 1}`;
      const sentences: Sentence[] = s.x.map((x, xi) => {
        const [germanText, englishText, targetText, grammarNote] = x;
        if (!germanText.includes(targetText)) {
          throw new Error(`Target "${targetText}" not found in sentence "${germanText}"`);
        }
        return {
          id: `${senseId}:${xi + 1}`,
          senseId,
          germanText,
          englishText,
          cefrLevel: e.c,
          targetText,
          grammarNote,
          source: data.meta.source,
          license: data.meta.license
        };
      });
      return {
        id: senseId,
        wordId: id,
        order: si + 1,
        englishAnswers: s.en,
        germanVariants: s.de,
        register: s.reg,
        grammarNote: s.gn,
        usageNote: s.un,
        sentences
      };
    });

    const word: Word = {
      id,
      lemma: e.l,
      cefrLevel: e.c,
      frequencyRank: e.rank ?? index + 1,
      partOfSpeech: e.p,
      senses,
      source: data.meta.source,
      license: data.meta.license
    };
    if (e.art) {
      word.article = e.art;
      word.gender = GENDER_BY_ARTICLE[e.art];
    }
    if (e.pl) word.plural = e.pl;
    if (e.gen) word.genitive = e.gen;
    if (e.v) {
      word.verbForms = {
        thirdPersonPresent: e.v.p3,
        preterite: e.v.pret,
        pastParticiple: e.v.pp,
        auxiliary: e.v.aux,
        separable: e.v.sep,
        reflexive: e.v.refl,
        governedPreposition: e.v.prep
      };
    }
    if (e.adj) word.adjectiveForms = { comparative: e.adj.comp, superlative: e.adj.sup };
    if (e.case) word.governedCase = e.case;
    return word;
  });
}
