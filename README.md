# Wortschatz — German flashcard PWA (Phase 3)

Mobile-first, offline-capable German vocabulary trainer implementing Phases 1
to 3 of the product specification: typed German→English and English→German
translation with FSRS spaced repetition, independent learning states per
direction, contextual sentences, cloze reinforcement after errors, grade
override with learner-accepted translations, weak-word sessions, detailed
progress analysis, offline persistence in IndexedDB (versioned schema with
migrations), JSON/CSV import and export, audio for every word, personal
lists, a placement flow, and end-to-end-encrypted cloud sync between devices.

## Run

```bash
npm install
npm run dev        # development server
npm run build      # production build with service worker → dist/
npm run preview    # serve dist/ (use this to test offline behaviour)
npm test           # unit + integration tests (Vitest, fake-indexeddb)
npm run typecheck
npm run validate:vocab   # content checks for every file in data/vocab
```

## Project layout

```
data/vocab/*.json             Vocabulary content (compact authoring format, CC0); every file is bundled
scripts/validate-vocab.ts     CLI content validation (same rules as the import UI)
src/domain/                   Pure logic, no I/O
  types.ts                    Entities (Word, WordSense, Sentence, LearningState, …)
  grader.ts                   Answer normalization + Correct/Almost/Wrong/Unknown
  text.ts                     Unicode/umlaut folding, edit distance
  scheduler.ts                FSRS wrapper (ts-fsrs), outcome→grade mapping
  session.ts                  Session queue: due-first, new-word allowance, cloze/retry requeue
  cloze.ts                    Blank/highlight helpers
  stats.ts                    Progress aggregation
src/db/                       Dexie schema (versioned) + repository with transactional writes
src/data/                     Dataset expansion, JSON/CSV import, content validation
src/sync/                     Encrypted cloud sync: crypto, merge, providers, engine
.github/workflows/deploy.yml  GitHub Pages deployment (build + test on every push to main)
src/ui/                       React screens: Dashboard, Setup, Session, Browser, Stats, Settings
tests/                        grader, scheduler, session, persistence, dataset
```

Vocabulary content is separate from application logic. Replace or extend
`data/vocab/*.json` (or import a JSON file from Settings) without touching code.

## Key behaviours

| Area | Behaviour |
| --- | --- |
| Grading | Trim + NFC normalize; case-insensitive except German noun capitalization (Almost); `ae/oe/ue/ss` for `ä/ö/ü/ß` = Almost by default (configurable strict/accept); missing or wrong article on EN→DE nouns = Almost; edit distance ≤1 (≤2 for 8+ letters) = Almost; anything else = Wrong. Every downgrade carries a reason string shown to the learner. |
| FSRS mapping | Correct→Good, Almost→Hard, Wrong / I don't know→Again. Learning steps 1m/10m, relearning 10m, desired retention configurable. |
| Independent states | One `LearningState` per (sense, skill). `de_en` and `en_de` never influence each other. |
| Failed cards | Wrong/Unknown: a cloze of the example sentence is inserted 3 cards later and an unaided retry 3 cards after that. Almost: retry only. Max 2 retries per card per session. Cloze results are logged but never change the FSRS state. |
| Session order | Overdue reviews first (most overdue first), then new words up to `min(session limit, daily limit − introduced today)`. Cards are never shown before they are due. |
| One direction per word | A word sense appears at most once per session (plus its own cloze/retry). In mixed mode new words alternate DE→EN / EN→DE across different words; if both directions of a word are due, only the more overdue one is shown and the other waits for the next session. The second direction of an already-introduced word does not count against the daily new-word allowance. |
| Accepted translations | "Report → my translation should be accepted" stores the answer per card (schema v2 `customAnswers`); the grader treats it as correct from then on and the current grade flips to Correct. Manage them in the vocabulary browser. |
| Weak-word sessions | Dashboard button. Cards with a lapse or a non-correct last result that are due now or within the hour; no new words. |
| Statistics | Due forecast for 7 days, new/learning/mature per CEFR level, 30-day review and accuracy trend, error types and error rate per direction, leeches. |
| Personal lists | Create lists from a word's detail view; restrict a session to one list in setup. Lists sync. |
| Placement | Dashboard → Placement: tick the words you already know, per level, 24 at a time; they become mature reviews. |
| Cloud sync | Settings → Cloud sync. Backups are AES-256-GCM encrypted on the device with a passphrase (PBKDF2, 310k iterations); the server stores only ciphertext. Merge is deterministic: review logs are unioned, learning states take the later review, settings and lists take the newer timestamp, daily stats are recomputed from the log, in-progress sessions never leave the device. Optimistic concurrency with retry. Auto-sync on app start and after each finished session. |
| Secondary senses | Unlock only after the previous sense is in review with ≥7 days stability. |
| Persistence | Each review writes learning state + append-only log + session progress + daily counters in one IndexedDB transaction. An interrupted session resumes from the dashboard. |
| Timestamps | Stored as UTC ISO strings; daily goals use the local calendar day. |
| Export | Full JSON backup (restorable), vocabulary JSON and CSV. |

## Data licensing

The bundled datasets (`data/vocab/sample-a1a2.json`, 170 A1/A2 entries, and
`data/vocab/extended-a2b1.json`, 129 A2/B1 entries with multiple senses,
regional variants and reflexive/separable verbs) were written for this
project and are released under CC0-1.0. Nothing was copied
from Vocabeo or any other third-party dataset; frequency ranks are only the
position in the file. Each word and sentence stores `source` and `license`.
Before importing a full 6,000-word list, confirm the licence of every
component (headwords, translations, sentences, audio) separately. Import
via Settings accepts the compact JSON format, a previous export, or CSV with
columns `lemma, partOfSpeech, cefrLevel, englishAnswers` (semicolon-separated)
plus optional `article, plural, exampleDe, exampleEn, target,
thirdPersonPresent, preterite, pastParticiple, auxiliary, grammarNote,
usageNote, source, license, frequencyRank`. Files are validated before any
write; rows sharing lemma + part of speech become senses of one word.
Sentences may carry an `audioReference` URL, played in preference to speech
synthesis.

## Cloud sync setup (Supabase)

1. Create a free project at supabase.com.
2. In the SQL editor run the statement shown in Settings → Cloud sync (creates `public.backups` with row-level security so each user only sees their own row).
3. In Authentication → Providers keep Email enabled. If "Confirm email" is on, confirm the sign-up email once.
4. In the app paste the project URL and anon key, create an account, choose a passphrase, and press Sync now. Do the same on every device with the same account and passphrase.

## Hosting (GitHub Pages)

`.github/workflows/deploy.yml` builds and tests on every push to `main` and
publishes `dist/` to GitHub Pages under `/<repository name>/` (the workflow
sets `BASE_PATH`). Enable Pages with source "GitHub Actions" once.

## DTZ word list (personal use)

`data/vocab/dtz-a2b1.json` is generated from the learner's own copy of the
Goethe-Institut/telc *DTZ-Wortliste* PDF by `scripts/extract-dtz.py`
(column- and font-aware extraction, plural/verb-form parsing, cleanup) and
`scripts/build-dtz.py` (merges the extracted entries with English
translations written for this project). The German headwords, grammar and
example sentences are copyrighted by Goethe-Institut/telc; this is a personal,
non-commercial study project and the data is bundled for the owner's own use
only. Every entry is tagged B1 because the list carries no per-word level, and
entries get a stable shuffled rank so new words are not introduced
alphabetically.

Regenerate:

```bash
PYTHONPATH=<dir with pdfplumber> python3 scripts/extract-dtz.py dtz_wortliste.pdf raw.json
python3 scripts/dtz-pending.py raw.json pending.json            # entries not already in data/vocab
python3 scripts/build-dtz.py pending.json scripts/dtz-translations data/vocab/dtz-a2b1.json
```

## OCR GCSE word list (personal use)

`data/vocab/ocr-gcse-a2b1.json` (740 entries) comes from the OCR GCSE German
Vocabulary List PDF: `scripts/extract-ocr.py` reads the German/English pairs,
`scripts/ocr-pending.py` drops everything already in `data/vocab`, and the
hand-written batches in `scripts/ocr-entries/` add articles, plurals, verb
forms and original example sentences. Foundation-tier words are tagged A2,
Higher-tier words B1. Regenerate with `python3 scripts/build-ocr.py
data/vocab/ocr-gcse-a2b1.json`.

## Not yet implemented

Pronunciation exercises with speech recognition (deliberately left out: the
learner only wants audio playback, not a speaking test), spelling as a
separately scheduled skill, licensed audio files, social features, and the
additional exercise modes from spec §8 (article selection,
plural/verb-form production, listen-and-type, sentence reconstruction,
confusing-word comparisons).
