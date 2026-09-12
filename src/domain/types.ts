// Core domain entities. Mirrors spec §11 with a few additions needed by the
// scheduler (FSRS state/learning steps) and the grader (accepted German forms).

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export const CEFR_LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export type PartOfSpeech =
  | "noun"
  | "verb"
  | "adjective"
  | "adverb"
  | "preposition"
  | "pronoun"
  | "conjunction"
  | "numeral"
  | "interjection"
  | "particle"
  | "other";

export type Gender = "masculine" | "feminine" | "neuter";
export type Article = "der" | "die" | "das";

/** Skills tracked independently (spec §5). Phase 1 schedules de_en and en_de only. */
export type Skill = "de_en" | "en_de" | "spelling" | "pronunciation";
export const PHASE1_SKILLS: Skill[] = ["de_en", "en_de"];

/** Written-answer outcomes (spec §4). */
export type Outcome = "correct" | "almost" | "wrong" | "unknown";

export type VerbForms = {
  thirdPersonPresent?: string;
  preterite?: string;
  pastParticiple?: string;
  auxiliary?: "haben" | "sein";
  separable?: boolean;
  reflexive?: boolean;
  /** e.g. "warten auf + Akk." */
  governedPreposition?: string;
};

export type AdjectiveForms = {
  comparative?: string;
  superlative?: string;
};

export type Word = {
  id: string;
  lemma: string;
  cefrLevel: CefrLevel;
  frequencyRank: number;
  partOfSpeech: PartOfSpeech;
  gender?: Gender;
  article?: Article;
  plural?: string;
  genitive?: string;
  verbForms?: VerbForms;
  adjectiveForms?: AdjectiveForms;
  /** For prepositions: governed case(s), e.g. "Dativ" or "Dativ/Akkusativ". */
  governedCase?: string;
  senses: WordSense[];
  source: string;
  license?: string;
};

export type WordSense = {
  id: string;
  wordId: string;
  order: number;
  /** Accepted English translations, first one is the canonical display form. */
  englishAnswers: string[];
  /** Additional accepted German forms (regional variants, spelling variants). */
  germanVariants?: string[];
  register?: string;
  grammarNote?: string;
  /** Common collocation or usage pattern shown after answering. */
  usageNote?: string;
  sentences: Sentence[];
};

export type Sentence = {
  id: string;
  senseId: string;
  germanText: string;
  englishText: string;
  cefrLevel: CefrLevel;
  /** The exact substring of germanText that carries the target word (for highlighting and cloze). */
  targetText: string;
  grammarNote?: string;
  audioReference?: string;
  source: string;
  license?: string;
};

/** FSRS card state, numeric to match ts-fsrs. */
export type FsrsPhase = 0 | 1 | 2 | 3; // New, Learning, Review, Relearning

export type LearningState = {
  /** Composite key: `${senseId}|${skill}` */
  key: string;
  wordId: string;
  senseId: string;
  skill: Skill;
  /** ISO-8601 UTC */
  dueAt: string;
  stability: number;
  difficulty: number;
  repetitions: number;
  lapses: number;
  lastReviewedAt?: string;
  lastResult?: Outcome;
  phase: FsrsPhase;
  learningSteps: number;
  scheduledDays: number;
  elapsedDays: number;
  suspended?: boolean;
  /** Set when the user marks the word as already known. */
  markedKnownAt?: string;
};

export type ReviewMode = "unaided" | "cloze";

export type ReviewLogEntry = {
  id?: number;
  sessionId: string;
  wordId: string;
  senseId: string;
  skill: Skill;
  mode: ReviewMode;
  reviewedAt: string;
  outcome: Outcome;
  proposedOutcome: Outcome;
  overridden: boolean;
  answerGiven: string;
  reasons: string[];
  /** Snapshot of scheduling values before/after (for debugging). Absent for cloze. */
  before?: Pick<LearningState, "dueAt" | "stability" | "difficulty" | "phase">;
  after?: Pick<LearningState, "dueAt" | "stability" | "difficulty" | "phase" | "scheduledDays">;
  /** Whether this review was a same-session retry after a failure. */
  retry?: boolean;
};

export type UmlautTolerance = "strict" | "almost" | "accept";

export type Settings = {
  id: "settings";
  schemaVersion: number;
  dailyNewWordLimit: number;
  dailyReviewGoal: number;
  umlautTolerance: UmlautTolerance;
  requireArticle: boolean;
  audioEnabled: boolean;
  theme: "system" | "light" | "dark";
  /** FSRS desired retention, 0.7–0.97 */
  requestRetention: number;
  /** ISO timestamp of the last change; newer wins when syncing. */
  updatedAt?: string;
};

export const DEFAULT_SETTINGS: Settings = {
  id: "settings",
  schemaVersion: 1,
  dailyNewWordLimit: 10,
  dailyReviewGoal: 50,
  umlautTolerance: "almost",
  requireArticle: true,
  audioEnabled: true,
  theme: "system",
  requestRetention: 0.9
};

export type DirectionChoice = "de_en" | "en_de" | "mixed" | "pronunciation";

export type SessionConfig = {
  direction: DirectionChoice;
  levels: CefrLevel[];
  cardCount: number;
  newWordLimit: number;
  filter: "all" | "new" | "due" | "weak" | "nouns" | "verbs";
  /** Explicit learner choice to introduce more new words than today's remaining allowance. */
  ignoreDailyLimit?: boolean;
  /** Restrict the session to the senses of one personal list. */
  listId?: string;
};

/** Why a session queue is as long (or as empty) as it is. */
export type SessionDiagnostics = {
  availableNew: number;
  allowance: number;
  remainingToday: number;
  dailyLimit: number;
  dueCount: number;
  nextDueAt?: string;
};

export type QueueItem = {
  /** Unique within a session */
  uid: string;
  senseId: string;
  wordId: string;
  skill: Skill;
  mode: ReviewMode;
  /** True when this card had no prior reviews in this skill at session build time. */
  isNew: boolean;
  /** True when this item is a same-session retry after failure. */
  retry: boolean;
  sentenceId?: string;
};

export type SessionRecord = {
  id: string;
  config: SessionConfig;
  startedAt: string;
  endedAt?: string;
  queue: QueueItem[];
  /** Index of next queue item to present. */
  cursor: number;
  /** Items answered so far, for the summary. */
  answered: { uid: string; outcome: Outcome; mode: ReviewMode }[];
  /** senseIds introduced as new in this session (for daily-limit accounting). */
  newSenseIds: string[];
  status: "active" | "finished" | "abandoned";
  diagnostics?: SessionDiagnostics;
};

export type DailyStats = {
  /** Local calendar date, YYYY-MM-DD */
  day: string;
  reviews: number;
  newWords: number;
  correct: number;
  almost: number;
  wrong: number;
};

export type ContentReport = {
  id?: number;
  createdAt: string;
  senseId: string;
  sentenceId?: string;
  kind: "bad_sentence" | "missing_translation" | "other";
  text: string;
};

/** A translation the learner asked to be accepted in future (spec §4: override for missing answers). */
export type CustomAnswer = {
  id?: number;
  senseId: string;
  skill: Skill;
  answer: string;
  createdAt: string;
};

/** A learner-made vocabulary list (spec §8, later modes). */
export type PersonalList = {
  id: string;
  name: string;
  senseIds: string[];
  createdAt: string;
  updatedAt: string;
};

export const stateKey = (senseId: string, skill: Skill) => `${senseId}|${skill}`;
