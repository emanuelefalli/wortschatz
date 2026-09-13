# Handoff: Wortschatz — German flashcard PWA
2026-09-13 · Build and run a personal German vocabulary trainer from a written spec; phases 1–3 delivered, now in daily use and being tuned.

## Objective
A mobile-first, offline-capable PWA that teaches German vocabulary with typed translation in both directions, FSRS spaced repetition, contextual sentences and cloze reinforcement, per the spec in `/Users/testname/Downloads/German-flashcard-game-spec.md`. Success = installable, works offline, progress survives reloads, syncs between the owner's devices. All of that is done; remaining work is polish and whatever the owner asks for next.

## Current state
- Live at **https://emanuelefalli.github.io/wortschatz/**, deployed automatically by GitHub Actions from every push to `main` of **github.com/emanuelefalli/wortschatz** (public repo). The workflow runs `npm test` and `npm run build` with `BASE_PATH=/wortschatz/`.
- Local checkout: `/Users/testname/Downloads/german-flashcards`, branch `main`, clean, in sync with origin.
- 83 Vitest tests pass; `npm run validate:vocab` reports 0 errors across 5 vocabulary files.
- Vocabulary in the app: **3,150 words / 3,165 senses** (A2 497, B1 2,653). A1 (165 words) is hidden by `HIDDEN_LEVELS` in `src/data/loader.ts` and pruned from existing databases on startup; the words remain in the data files.
- The learner can add words by hand: Words → **＋ Add word** (German headword, English translation, optional example sentence). Duplicates are blocked against the whole vocabulary; added words carry the source `user:manual`, sync with progress and can be deleted from their detail view.
- Sync: code complete and tested with an in-memory provider. The owner created a Supabase project (`https://rorzifiaustuevcgeglz.supabase.co`, publishable key of the form `sb_publishable_…`). **The project is now built into the app** (`src/sync/defaults.ts`, overridable by the `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` repository variables forwarded by the deploy workflow; the URL variable is set, **the key variable still has to be set by the owner** because the key only exists in their browser). Until the key is set the deployed build shows the old "paste URL and key" form. **Not yet confirmed working end to end** — the owner still has to run the setup SQL once, create an account in the app (email + password), set a passphrase and press Sync now.
- The owner is actively testing on their own browser and reporting issues in plain language; expect more of the same.

## Decisions (and why)
- **Stack**: Vite 8 + React 19 + TypeScript 7 (strict), Dexie 4 (IndexedDB, schema v3 with migrations), ts-fsrs 5, vite-plugin-pwa (Workbox, autoUpdate), Vitest 5 + fake-indexeddb, `@supabase/supabase-js`. No backend of our own.
- **Grading** (`src/domain/grader.ts`): NFC-normalised, case-insensitive except German noun capitalisation (=Almost); `ae/oe/ue/ss` for umlauts = Almost by default (setting: strict/almost/accept); missing or wrong article on EN→DE nouns = Almost; edit distance ≤1 (≤2 for 8+ letters) = Almost; else Wrong. Only stored synonyms and learner-added custom answers are accepted, never semantic relatives.
- **FSRS mapping**: Correct→Good, Almost→Hard, Wrong/I-don't-know→Again; learning steps 1m/10m, relearning 10m; desired retention configurable (default 0.9). One independent state per (sense, direction).
- **Failed-card loop**: Wrong/Unknown → cloze of the example sentence inserted 3 cards later, then an unaided retry 3 cards after that; Almost → retry only; max 2 retries per card per session. Cloze results are logged but never change the FSRS state.
- **One word per session**: a word sense appears at most once per session in one direction; mixed sessions alternate directions across different words; if both directions are due only the more overdue one is shown. (Owner explicitly disliked seeing the same word flipped straight after.)
- **New-word selection is a seeded random sample** of unstarted words at the chosen levels (seed = session id, so a resumed session is stable). Changed from rank order because the owner saw the same words every session.
- **Daily new-word allowance counts word senses, not directions**; the second direction of an already-met word is free. Setup shows "N of M left today" and a checkbox "Go beyond today's limit for this session"; an empty session explains why (`SessionDiagnostics`).
- **Secondary senses** unlock only after the first sense is in review with ≥7 days stability.
- **Sync design** (`src/sync/`): backup encrypted on device with AES-256-GCM, key from PBKDF2-SHA256 (310k iterations) of a passphrase; server stores ciphertext only. One `backups` row per Supabase user with optimistic version check and retry. Merge (`merge.ts`) is deterministic: review logs unioned, learning state with later `lastReviewedAt` wins, settings/lists by `updatedAt`, daily stats recomputed from the log, **active sessions never leave their device**. Auto-sync on app start and after each finished session. Email+password auth (chosen over magic link/OTP to avoid email-template setup).
- **Hosting** on GitHub Pages from a public repo because Pages on a private repo needs a paid plan; the owner accepted that the repo and the bundled personal word lists are public ("personal project, I won't benefit from it").
- **Datasets bundled into the JS** (owner's explicit choice after I proposed keeping personal data out of the bundle).
- **Vocabulary files** (`data/vocab/`, compact authoring format `compact-v1`, expanded by `src/data/compactFormat.ts`; every JSON file there is bundled automatically, ordered easy→hard by the file's dominant level):
  - `sample-a1a2.json` 170 words, `extended-a2b1.json` 129 words — original CC0 content written for the project.
  - `dtz-a2b1.json` 2,263 entries from the owner's Goethe/telc DTZ-Wortliste PDF (`dtz_wortliste.pdf`, git-ignored): headwords, grammar and German sentences from the PDF, English translations written for the project (`scripts/dtz-translations/`). All tagged B1 (list has no per-word levels). Stable shuffled `rank` so new words are not alphabetical.
  - `listen-tabellen-a2b1.json` 13 entries from Witzlinger's *Deutsch – Aber Hallo! Listen & Tabellen A1–A2* (`listen-tabellen_a1-a2.pdf`, git-ignored): the PDF holds 166 verbs, 153 of which were already in the other files, so only the 13 missing ones were authored (`scripts/listen-entries/`) with verb forms, government patterns and original sentences.
  - `ocr-gcse-a2b1.json` 740 entries from the OCR GCSE list PDF (`68532-vocabulary-list-by-topic.pdf`, git-ignored): pairs extracted, then articles/plurals/verb forms/original sentences hand-written in `scripts/ocr-entries/`. Foundation→A2, Higher→B1.
  - Duplicates are prevented by lemma (case-insensitive, ignoring "sich") in the pending scripts, `scripts/build-ocr.py`, `scripts/build-listen.py`, the Add-word dialog (`findExistingWord`) and `tests/bundle.test.ts`.
- **Levels**: the app's CEFR tags for DTZ/OCR/Aber-Hallo are approximations chosen by us, not from the sources.
- **Manual word entry** (`src/data/userWord.ts`, `src/ui/components/AddWordDialog.tsx`): pure parse/validate helpers plus a modal on the Words screen. The article is taken from `der/die/das` typed in front of the headword, the part of speech is guessed from the spelling (capital = noun, `sich …` or `-en/-eln/-ern` = verb) and both can be overridden. The cloze target is auto-detected in the example sentence (exact match, then a shared stem, so `gehen → gehe` and `Katze → Katzen` work) and can be picked from chips when the detection fails, e.g. for strong verbs (`essen → isst`). The example sentence is **optional**; `applyAnswer` now inserts the cloze step only when the card has a sentence, so a bare word just gets the unaided retry. Words are stored with `source: "user:manual"`, which keeps them out of `pruneBundledWords` and marks them deletable (`deleteWord` also clears learning states, custom answers and list memberships; the review log is kept as history).

## Dead ends — do not retry
- **Pronunciation/speaking exercise with Web Speech recognition**: built, then removed at the owner's request ("don't want the pronunciation game"). Keep only the audio playback buttons (speech synthesis) on cards. The `pronunciation` skill type stays unused.
- **Keeping the DTZ data out of the bundle (import-once flow)**: implemented, then reverted because the owner prefers bundling.
- **A1 vocabulary**: hidden on request ("I know all those words already"). Don't reintroduce it; the data files still contain it if ever wanted.
- **Rank-ordered new words**: replaced by random sampling (see Decisions).
- **Alphabetical DTZ order**: the PDF is alphabetical; the file stays alphabetical for inspection but ranks are shuffled.
- **Vocabeo dataset**: never scraped or copied; only the CEFR-level idea is shared. Do not revisit.

## Artifacts
- Repo `github.com/emanuelefalli/wortschatz` (final, live). Key paths: `src/domain/` (pure logic: types, grader, scheduler, session, cloze, stats, text, time), `src/db/` (Dexie schema v3 + repository with transactional `recordReview`, backup export/import, lists, custom answers), `src/sync/` (crypto, merge, provider, supabaseProvider, engine, client), `src/ui/` (hash router; screens Dashboard, SessionSetup, Session, Browser, Stats, Placement, Settings; `components/SyncPanel.tsx`), `src/data/` (loader with `HIDDEN_LEVELS`, csv import, validate, userWord), `data/vocab/*.json`, `scripts/` (extract-dtz.py, dtz-pending.py, build-dtz.py, extract-ocr.py, ocr-pending.py, build-ocr.py, extract-listen.py, build-listen.py, validate-vocab.ts), `tests/` (11 files), `.github/workflows/deploy.yml`, `README.md` (up to date incl. Supabase setup SQL and steps), `.claude/launch.json` (preview server for the in-app browser).
- Git-ignored, local only: `dtz_wortliste.pdf`, `68532-vocabulary-list-by-topic.pdf`, `listen-tabellen_a1-a2.pdf`, `data/personal/dtz-pending.json`.
- Memory notes for future Claude sessions exist (`german-flashcards-pwa`, `one-direction-per-word-sessions`, `no-pronunciation-exercise`, `no-node-on-machine`).
- Earlier zip of the Phase 1 code: superseded by the repo.

## Verbatim essentials
- Live URL: `https://emanuelefalli.github.io/wortschatz/` · repo `emanuelefalli/wortschatz` · Pages source = GitHub Actions.
- Supabase project URL: `https://rorzifiaustuevcgeglz.supabase.co` (baked into `src/sync/defaults.ts`; the publishable key is in the owner's browser Settings and should go into the `VITE_SUPABASE_ANON_KEY` repository variable or the same file).
- Setup SQL (also in Settings → Cloud sync and README):
  ```sql
  create table if not exists public.backups (
    user_id uuid primary key references auth.users(id) on delete cascade,
    payload text not null,
    version integer not null default 1,
    updated_at timestamptz not null default now()
  );
  alter table public.backups enable row level security;
  create policy "own backup" on public.backups
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  ```
- Commands: `npm install`, `npm test`, `npm run typecheck`, `npm run build`, `npm run preview`, `npm run validate:vocab`; regenerate datasets with `python3 scripts/build-dtz.py data/personal/dtz-pending.json scripts/dtz-translations data/vocab/dtz-a2b1.json` and `python3 scripts/build-ocr.py data/vocab/ocr-gcse-a2b1.json` and `python3 scripts/build-listen.py data/vocab/listen-tabellen-a2b1.json` (extraction needs `pdfplumber` on `PYTHONPATH`).
- Toolchain quirk: **this Mac has no Node/npm/brew**. Node 24 LTS was downloaded (checksum-verified) into the session scratchpad and used via `export PATH=<scratchpad>/node/node-v24.21.0-darwin-arm64/bin:$PATH`; a new session must repeat that (or the owner installs Node from nodejs.org). `gh` is at `~/bin/gh`, logged in as emanuelefalli. The in-app browser preview needs `.claude/launch.json` at the session root pointing at `node_modules/vite/bin/vite.js preview`.
- Git commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; author used so far: "Emanuele Falli".

## Working preferences
- The owner reports bugs in one or two sentences and expects fixes deployed, not discussion; verify on the live site after pushing.
- No speaking/recording exercises; audio playback yes.
- Never show the same word in both directions within one session.
- A1 is gone; treat A2 as the lowest level.
- Personal-use licensing is accepted by the owner for the DTZ and OCR lists; still keep the PDFs out of the repo.
- Dedupe any new word list against the existing files before importing; the owner explicitly asked for "no duplicates". Report how many entries were dropped as duplicates.
- Expect lists to be dropped into the project folder as PDFs with a filename mention; extract, dedupe, author grammar + sentences, tag levels, validate, commit, push.

## Open items
- Next step: get the publishable key from the owner and either run `gh variable set VITE_SUPABASE_ANON_KEY -R emanuelefalli/wortschatz --body "<key>"` (then re-run the deploy workflow) or paste it into `src/sync/defaults.ts`. Then confirm sync end to end once the owner has run the SQL, created the in-app account and pressed Sync now; fix whatever error message comes back (only the in-memory provider has been exercised so far).
- Then: watch for the owner's next usability reports (the "same words again" feedback also came from learning-step reviews returning after 1–10 minutes, which is intended; if it keeps bothering them, consider a setting for longer learning steps).
- Possible follow-ups never requested: article/plural exercise modes, spelling skill, licensed audio, social features (spec's later modes). Do not build unasked.
- Unresolved: none.

## Suggested opening prompt
"Continue work on Wortschatz, my German flashcard PWA. Read HANDOFF.md in /Users/testname/Downloads/german-flashcards first — it has the current state, decisions, and things not to redo. Node is not installed on this Mac; set it up in the scratchpad as described there before running tests. Then: [describe the issue or feature]."
