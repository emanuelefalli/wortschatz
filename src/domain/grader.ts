// Answer normalization and classification (spec §4). Pure functions, no I/O.

import type { Outcome, Skill, UmlautTolerance, Word, WordSense } from "./types";
import {
  editDistance,
  foldUmlauts,
  hasUmlautSubstitution,
  lower,
  normalizeBasic,
  stripPunctuation,
  typoBudget
} from "./text";

export type GradeOptions = {
  umlautTolerance: UmlautTolerance;
  requireArticle: boolean;
  /** Learner-added accepted answers for this card (see CustomAnswer). */
  extraAccepted?: string[];
};

export type GradeResult = {
  outcome: Outcome;
  /** Human-readable explanations of why the answer was not fully correct. */
  reasons: string[];
  /** The canonical expected answer to show the learner. */
  expected: string;
  /** All accepted forms (for display / debugging). */
  accepted: string[];
};

export const DEFAULT_GRADE_OPTIONS: GradeOptions = { umlautTolerance: "almost", requireArticle: true };

const ARTICLES = ["der", "die", "das"] as const;

/** Canonical display answer for a card. */
export function expectedAnswer(word: Word, sense: WordSense, skill: Skill): string {
  if (skill === "de_en") return sense.englishAnswers[0];
  if (word.partOfSpeech === "noun" && word.article) return `${word.article} ${word.lemma}`;
  return word.lemma;
}

/** Prompt text shown before answering. Never includes the answer or a sentence. */
export function promptText(word: Word, sense: WordSense, skill: Skill): string {
  if (skill === "de_en") {
    if (word.partOfSpeech === "noun" && word.article) return `${word.article} ${word.lemma}`;
    return word.lemma;
  }
  return sense.englishAnswers[0];
}

/** Accepted German forms for EN→DE (without article handling). */
function acceptedGerman(word: Word, sense: WordSense, extra: string[] = []): string[] {
  const isNoun = word.partOfSpeech === "noun" && !!word.article;
  const extras = extra.map((e) => {
    const cleaned = stripPunctuation(normalizeBasic(e));
    return isNoun ? splitArticle(cleaned).rest : cleaned;
  });
  return [word.lemma, ...(sense.germanVariants ?? []), ...extras];
}

/** Accepted English forms for DE→EN, including "to"-less verb forms and "the"-less nouns. */
function acceptedEnglish(sense: WordSense, word: Word, extra: string[] = []): string[] {
  const out = new Set<string>();
  for (const ans of [...sense.englishAnswers, ...extra]) {
    out.add(ans);
    if (word.partOfSpeech === "verb" && ans.startsWith("to ")) out.add(ans.slice(3));
    if (word.partOfSpeech === "noun") out.add(`the ${ans}`);
  }
  return [...out];
}

function canonicalEnglish(s: string): string {
  return lower(stripPunctuation(normalizeBasic(s)));
}

export function gradeAnswer(
  word: Word,
  sense: WordSense,
  skill: Skill,
  rawAnswer: string,
  options: GradeOptions = DEFAULT_GRADE_OPTIONS
): GradeResult {
  const expected = expectedAnswer(word, sense, skill);
  const answer = normalizeBasic(rawAnswer);
  if (answer === "") {
    return { outcome: "unknown", reasons: ["No answer given."], expected, accepted: [] };
  }
  return skill === "de_en"
    ? gradeEnglish(word, sense, answer, expected, options.extraAccepted ?? [])
    : gradeGerman(word, sense, answer, expected, options);
}

function gradeEnglish(word: Word, sense: WordSense, answer: string, expected: string, extra: string[]): GradeResult {
  const accepted = acceptedEnglish(sense, word, extra);
  const given = canonicalEnglish(answer);
  const acceptedCanon = accepted.map(canonicalEnglish);

  if (acceptedCanon.includes(given)) {
    return { outcome: "correct", reasons: [], expected, accepted };
  }
  // Allow "a table"/"an apple" for nouns.
  const noDeterminer = given.replace(/^(a|an) /, "");
  if (word.partOfSpeech === "noun" && acceptedCanon.includes(noDeterminer)) {
    return { outcome: "correct", reasons: [], expected, accepted };
  }
  // Minor typo against any accepted answer.
  for (const a of acceptedCanon) {
    const budget = typoBudget(a.length);
    if (budget > 0 && editDistance(given, a) <= budget) {
      return {
        outcome: "almost",
        reasons: [`Spelling: you wrote "${answer}", expected "${a}".`],
        expected,
        accepted
      };
    }
  }
  return {
    outcome: "wrong",
    reasons: [`"${answer}" is not an accepted translation of "${word.lemma}".`],
    expected,
    accepted
  };
}

function splitArticle(answer: string): { article?: string; rest: string } {
  const parts = answer.split(" ");
  const first = lower(parts[0]);
  if (parts.length > 1 && (ARTICLES as readonly string[]).includes(first)) {
    return { article: first, rest: parts.slice(1).join(" ") };
  }
  return { rest: answer };
}

function gradeGerman(
  word: Word,
  sense: WordSense,
  answer: string,
  expected: string,
  options: GradeOptions
): GradeResult {
  const acceptedForms = acceptedGerman(word, sense, options.extraAccepted ?? []);
  const isNoun = word.partOfSpeech === "noun" && !!word.article;
  const accepted = isNoun ? acceptedForms.map((f) => `${word.article} ${f}`) : acceptedForms;
  const reasons: string[] = [];
  let outcome: Outcome = "correct";
  const downgrade = (to: Outcome, reason: string) => {
    reasons.push(reason);
    if (to === "wrong" || outcome === "correct") outcome = to;
  };

  const cleaned = stripPunctuation(answer);
  const { article, rest } = splitArticle(cleaned);
  let core = rest;

  // Allow a separable-prefix marker ("an|rufen") in the answer.
  core = core.replace(/\|/g, "");

  // --- Article handling (EN→DE nouns) ---
  if (isNoun) {
    if (!article) {
      if (options.requireArticle) downgrade("almost", `Missing article: the noun is "${word.article} ${word.lemma}".`);
    } else if (article !== word.article) {
      downgrade("almost", `Wrong article: you wrote "${article}", but it is "${word.article} ${word.lemma}".`);
    }
  } else if (article) {
    // Non-noun given with an article: treat the article as part of the answer.
    core = cleaned;
  }

  // --- Match core against accepted German forms, in passes so that an exact
  // match on any stored variant wins over a tolerant match on another form ---
  const capitalizationReason = (form: string) =>
    downgrade("almost", `Capitalization: German nouns are capitalized – "${form}".`);

  let matched = acceptedForms.some((form) => core === form);

  if (!matched) {
    // Case-only difference. Nouns must be capitalized; other words are case-insensitive.
    const form = acceptedForms.find((f) => lower(core) === lower(f));
    if (form) {
      matched = true;
      if (isNoun && core[0] !== form[0]) capitalizationReason(form);
    }
  }

  if (!matched) {
    // Umlaut / ß substitutions (ae/oe/ue/ss), tolerance configurable.
    const form = acceptedForms.find((f) => hasUmlautSubstitution(lower(core), lower(f)));
    if (form) {
      matched = true;
      switch (options.umlautTolerance) {
        case "accept":
          break;
        case "almost":
          downgrade("almost", `Umlaut/ß: you wrote "${core}", the standard spelling is "${form}".`);
          break;
        case "strict":
          downgrade("wrong", `Umlaut/ß: "${core}" is not accepted; the spelling is "${form}".`);
          break;
      }
      if (isNoun && core[0] !== form[0] && lower(core[0]) === lower(form[0])) capitalizationReason(form);
    }
  }

  if (!matched) {
    // Minor typo against any accepted form.
    for (const form of acceptedForms) {
      const a = foldUmlauts(lower(core));
      const b = foldUmlauts(lower(form));
      const budget = typoBudget(b.length);
      if (budget > 0 && editDistance(a, b) <= budget) {
        matched = true;
        downgrade("almost", `Spelling: you wrote "${core}", expected "${form}".`);
        break;
      }
    }
  }

  if (!matched) {
    return {
      outcome: "wrong",
      reasons: [`"${answer}" is not the German word for "${sense.englishAnswers[0]}".`],
      expected,
      accepted
    };
  }

  return { outcome, reasons, expected, accepted };
}

/**
 * Grade a cloze answer: the learner types the missing target form. Compared
 * case-insensitively with umlaut tolerance (cloze is supportive evidence only).
 */
export function gradeCloze(targetText: string, rawAnswer: string): { correct: boolean; reason?: string } {
  const given = foldUmlauts(lower(stripPunctuation(normalizeBasic(rawAnswer))));
  const expected = foldUmlauts(lower(stripPunctuation(targetText)));
  if (given === "") return { correct: false, reason: "No answer given." };
  if (given === expected) return { correct: true };
  const budget = typoBudget(expected.length);
  if (budget > 0 && editDistance(given, expected) <= budget) {
    return { correct: true, reason: `Close enough: "${rawAnswer}" → "${targetText}".` };
  }
  return { correct: false, reason: `Expected "${targetText}".` };
}

/**
 * Compare a speech-recognition transcript with the target word. Recognition
 * is fuzzy by nature, so any alternative that contains the word (umlaut- and
 * case-insensitively, small typos allowed) counts as correct; a near miss is
 * "almost"; the learner can always override.
 */
export function gradePronunciation(targetWord: string, transcripts: string[]): { outcome: Outcome; reasons: string[] } {
  const target = foldUmlauts(lower(stripPunctuation(targetWord.replace(/^(der|die|das|sich)\s+/, ""))));
  const budget = typoBudget(target.length);
  let best = Infinity;
  for (const t of transcripts) {
    const words = foldUmlauts(lower(stripPunctuation(normalizeBasic(t)))).split(" ").filter(Boolean);
    if (words.join(" ").includes(target)) return { outcome: "correct", reasons: [] };
    for (const w of words) best = Math.min(best, editDistance(w, target));
    // multi-word targets (separable verbs, phrases): compare the joined string too
    best = Math.min(best, editDistance(words.join(" "), target));
  }
  if (best <= budget) return { outcome: "almost", reasons: [`Recognized something close: ${transcripts[0] ?? ""}.`] };
  return { outcome: "wrong", reasons: [`Recognized “${transcripts[0] ?? "nothing"}”, expected “${targetWord}”.`] };
}
