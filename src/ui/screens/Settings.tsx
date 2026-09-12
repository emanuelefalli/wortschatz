import { useRef, useState } from "react";
import { SCHEMA_VERSION } from "../../db/schema";
import { exportBackup, getAllWords, importBackup, importWords, resetProgress, wordsToCsv, type Backup } from "../../db/repo";
import { parseVocabularyFile } from "../../data/loader";
import { validateWords } from "../../data/validate";
import type { UmlautTolerance } from "../../domain/types";
import { downloadText, readFileText } from "../download";
import { useStore } from "../store";
import { SyncPanel } from "../components/SyncPanel";

export function SettingsScreen() {
  const { db, settings, updateSettings, reloadWords, words, toast } = useStore();
  const backupInput = useRef<HTMLInputElement>(null);
  const vocabInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const stamp = () => new Date().toISOString().slice(0, 10);

  const doExportBackup = async () => {
    const b = await exportBackup(db, SCHEMA_VERSION);
    downloadText(`wortschatz-backup-${stamp()}.json`, JSON.stringify(b));
    toast("Backup exported");
  };
  const doExportVocabJson = async () => {
    downloadText(`wortschatz-vocabulary-${stamp()}.json`, JSON.stringify({ words: await getAllWords(db) }, null, 2));
  };
  const doExportVocabCsv = async () => {
    downloadText(`wortschatz-vocabulary-${stamp()}.csv`, wordsToCsv(await getAllWords(db)), "text/csv");
  };
  const doImportBackup = async (file: File) => {
    setBusy(true);
    try {
      const b = JSON.parse(await readFileText(file)) as Backup;
      if (b.schemaVersion > SCHEMA_VERSION) throw new Error(`Backup schema ${b.schemaVersion} is newer than this app (${SCHEMA_VERSION}).`);
      await importBackup(db, b);
      await reloadWords();
      toast("Backup restored");
      window.location.reload();
    } catch (e) {
      toast(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const doImportVocab = async (file: File) => {
    setBusy(true);
    try {
      const parsed = parseVocabularyFile(file.name, await readFileText(file));
      const problems = validateWords(parsed);
      const errors = problems.filter((p) => p.severity === "error");
      if (errors.length) throw new Error(`${errors.length} problem(s), first: ${errors[0].where}: ${errors[0].message}`);
      const r = await importWords(db, parsed, `user:${file.name}`);
      await reloadWords();
      toast(`Imported ${r.inserted} new, ${r.updated} updated, ${r.skipped} unchanged`);
    } catch (e) {
      toast(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <h1>Settings</h1>

      <div className="card stack">
        <h3>Daily limits</h3>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="new-limit">New words per day</label>
            <input id="new-limit" type="number" min={0} max={100} value={settings.dailyNewWordLimit} onChange={(e) => void updateSettings({ dailyNewWordLimit: clamp(e.target.value, 0, 100) })} />
          </div>
          <div className="field">
            <label htmlFor="goal">Review goal per day</label>
            <input id="goal" type="number" min={1} max={1000} value={settings.dailyReviewGoal} onChange={(e) => void updateSettings({ dailyReviewGoal: clamp(e.target.value, 1, 1000) })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="retention">Desired retention: {Math.round(settings.requestRetention * 100)}%</label>
          <input id="retention" type="range" min={70} max={97} value={Math.round(settings.requestRetention * 100)} onChange={(e) => void updateSettings({ requestRetention: Number(e.target.value) / 100 })} />
          <span className="small muted">Higher retention means more frequent reviews.</span>
        </div>
      </div>

      <div className="card stack">
        <h3>Grading</h3>
        <div className="field">
          <label htmlFor="umlaut">ae/oe/ue/ss instead of ä/ö/ü/ß</label>
          <select id="umlaut" value={settings.umlautTolerance} onChange={(e) => void updateSettings({ umlautTolerance: e.target.value as UmlautTolerance })}>
            <option value="almost">Count as Almost (default)</option>
            <option value="accept">Accept as correct</option>
            <option value="strict">Count as Wrong</option>
          </select>
        </div>
        <label className="row">
          <input type="checkbox" checked={settings.requireArticle} onChange={(e) => void updateSettings({ requireArticle: e.target.checked })} />
          Require the article for English → German nouns
        </label>
      </div>

      <div className="card stack">
        <h3>Audio &amp; appearance</h3>
        <label className="row">
          <input type="checkbox" checked={settings.audioEnabled} onChange={(e) => void updateSettings({ audioEnabled: e.target.checked })} />
          Pronunciation via browser speech synthesis
        </label>
        <div className="field">
          <label htmlFor="theme">Theme</label>
          <select id="theme" value={settings.theme} onChange={(e) => void updateSettings({ theme: e.target.value as typeof settings.theme })}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>

      <SyncPanel />

      <div className="card stack">
        <h3>Data</h3>
        <p className="small muted">
          {words.length} words · schema v{SCHEMA_VERSION} · everything is stored on this device only.
        </p>
        <div className="row">
          <button type="button" className="btn small" onClick={doExportBackup} disabled={busy}>
            Export full backup (JSON)
          </button>
          <button type="button" className="btn small" onClick={() => backupInput.current?.click()} disabled={busy}>
            Restore backup
          </button>
          <input ref={backupInput} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void doImportBackup(e.target.files[0])} />
        </div>
        <div className="row">
          <button type="button" className="btn small" onClick={doExportVocabJson} disabled={busy}>
            Export vocabulary (JSON)
          </button>
          <button type="button" className="btn small" onClick={doExportVocabCsv} disabled={busy}>
            Export vocabulary (CSV)
          </button>
          <button type="button" className="btn small" onClick={() => vocabInput.current?.click()} disabled={busy}>
            Import vocabulary (JSON or CSV)
          </button>
          <input ref={vocabInput} type="file" accept="application/json,.json,text/csv,.csv" hidden onChange={(e) => e.target.files?.[0] && void doImportVocab(e.target.files[0])} />
        </div>
        <p className="small muted">
          Import accepts the compact dataset format (see data/vocab), a previous vocabulary export, or a CSV with columns lemma, partOfSpeech, cefrLevel, englishAnswers (separated by “;”) and optional article, plural, exampleDe, exampleEn, target, verb forms, notes, source, license. Files are validated before anything is written. Only import material you are licensed to use.
        </p>
        {confirmReset ? (
          <div className="row">
            <span className="small">Delete all learning progress? This cannot be undone.</span>
            <button
              type="button"
              className="btn small danger"
              onClick={async () => {
                await resetProgress(db);
                setConfirmReset(false);
                toast("Progress reset");
              }}
            >
              Yes, delete
            </button>
            <button type="button" className="btn small" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="btn small danger" onClick={() => setConfirmReset(true)}>
            Reset progress
          </button>
        )}
      </div>

      <div className="card">
        <h3>About</h3>
        <p className="small muted">
          Wortschatz is an offline German vocabulary trainer using FSRS spaced repetition. Bundled sample vocabulary: original content, CC0. No account, no server.
        </p>
      </div>
    </div>
  );
}

function clamp(v: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}
