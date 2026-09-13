import { useEffect, useState } from "react";
import { getSyncStatus, syncNow } from "../../sync/engine";
import { getProvider, isConfigured, loadPassphrase, loadSyncConfig, normalizeSupabaseUrl, resolveProject, savePassphrase, saveSyncConfig, type SyncConfig } from "../../sync/client";
import { hasBuiltInProject } from "../../sync/defaults";
import { SUPABASE_SETUP_SQL } from "../../sync/supabaseProvider";
import { useAsync } from "../hooks";
import { useStore } from "../store";

export function SyncPanel() {
  const { db, toast, reloadWords } = useStore();
  const [cfg, setCfg] = useState<SyncConfig>(() => loadSyncConfig());
  const [passphrase, setPassphrase] = useState(() => loadPassphrase());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { data: status, refresh } = useAsync(() => getSyncStatus(db), [db]);
  const configured = isConfigured(cfg);
  const builtIn = hasBuiltInProject();
  const usingOwnProject = cfg.url.trim() !== "" || cfg.anonKey.trim() !== "";

  useEffect(() => {
    if (!configured) {
      setSignedInAs(null);
      return;
    }
    let alive = true;
    getProvider(cfg)
      .userEmail()
      .then((e) => alive && setSignedInAs(e ?? null))
      .catch(() => alive && setSignedInAs(null));
    return () => {
      alive = false;
    };
  }, [cfg, configured]);

  const persist = (next: SyncConfig) => {
    setCfg(next);
    saveSyncConfig(next);
  };

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      const m = await fn();
      setMessage(m);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const doSync = () =>
    run(async () => {
      if (!passphrase) throw new Error("Enter your backup passphrase first.");
      savePassphrase(passphrase, cfg.rememberPassphrase);
      const r = await syncNow(db, getProvider(cfg), passphrase);
      await reloadWords();
      const label: Record<typeof r.status, string> = {
        uploaded: "Uploaded this device's progress",
        downloaded: "Downloaded newer progress from the cloud",
        merged: "Merged progress from both sides",
        unchanged: "Already up to date"
      };
      toast(label[r.status]);
      return `${label[r.status]} · ${r.reviews} reviews, ${r.words} words · version ${r.remoteVersion}`;
    });

  return (
    <div className="card stack">
      <h3>Cloud sync (encrypted)</h3>
      <p className="small muted">
        Your progress is encrypted on this device with a passphrase before it is uploaded; the server only stores ciphertext.
        {builtIn
          ? " On a new device just sign in with the same email and password and enter the same passphrase."
          : " This build has no project of its own, so you need a free Supabase project: create one, run the SQL below once in its SQL editor, then paste the project URL and key here."}
      </p>
      <details open={!builtIn}>
        <summary className="small">{builtIn ? (usingOwnProject ? "Using a different Supabase project" : "Use a different Supabase project") : "Supabase project"}</summary>
        <div className="stack" style={{ marginTop: "0.5rem" }}>
          {builtIn && (
            <p className="small muted">
              Leave these empty to use the project built into the app ({resolveProject({ ...cfg, url: "", anonKey: "" }).url}). Fill them in only to point this device at your own Supabase project.
            </p>
          )}
          <details>
            <summary className="small">SQL to run once in a new Supabase project</summary>
            <pre className="small" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>{SUPABASE_SETUP_SQL}</pre>
          </details>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="sb-url">Project URL</label>
              <input id="sb-url" type="text" placeholder="https://xxxx.supabase.co" value={cfg.url} onChange={(e) => persist({ ...cfg, url: e.target.value.trim() })} onBlur={(e) => persist({ ...cfg, url: normalizeSupabaseUrl(e.target.value) })} />
              <span className="small muted">Project Settings → API → Project URL. A pasted REST or dashboard link is reduced to the project URL automatically.</span>
            </div>
            <div className="field">
              <label htmlFor="sb-key">Publishable / anon key</label>
              <input id="sb-key" type="text" placeholder="sb_publishable_… or eyJ…" value={cfg.anonKey} onChange={(e) => persist({ ...cfg, anonKey: e.target.value.trim() })} />
            </div>
          </div>
          {builtIn && usingOwnProject && (
            <button type="button" className="btn small ghost" onClick={() => persist({ ...cfg, url: "", anonKey: "" })}>
              Back to the built-in project
            </button>
          )}
        </div>
      </details>

      {configured && !signedInAs && (
        <div className="stack">
          <div className="grid-2">
            <div className="field">
              <label htmlFor="sb-email">Email</label>
              <input id="sb-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="sb-pass">Password</label>
              <input id="sb-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn small primary"
              disabled={busy || !email || !password}
              onClick={() =>
                run(async () => {
                  await getProvider(cfg).signIn(email, password);
                  setSignedInAs(email);
                  return `Signed in as ${email}`;
                })
              }
            >
              Sign in
            </button>
            <button
              type="button"
              className="btn small"
              disabled={busy || !email || !password}
              onClick={() =>
                run(async () => {
                  const r = await getProvider(cfg).signUp(email, password);
                  if (r.needsConfirmation) return "Account created. Confirm the email Supabase sent you, then sign in.";
                  setSignedInAs(email);
                  return `Account created and signed in as ${email}`;
                })
              }
            >
              Create account
            </button>
          </div>
        </div>
      )}

      {signedInAs && (
        <div className="stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="small">
              Signed in as <strong>{signedInAs}</strong>
            </span>
            <button
              type="button"
              className="btn small ghost"
              onClick={() =>
                run(async () => {
                  await getProvider(cfg).signOut();
                  setSignedInAs(null);
                  return "Signed out";
                })
              }
            >
              Sign out
            </button>
          </div>
          <div className="field">
            <label htmlFor="sb-passphrase">Backup passphrase (never sent to the server)</label>
            <input id="sb-passphrase" type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="Choose a strong passphrase; use the same one on every device" />
          </div>
          <label className="row small">
            <input type="checkbox" checked={cfg.rememberPassphrase} onChange={(e) => persist({ ...cfg, rememberPassphrase: e.target.checked })} />
            Remember the passphrase on this device
          </label>
          <label className="row small">
            <input type="checkbox" checked={cfg.autoSync} onChange={(e) => persist({ ...cfg, autoSync: e.target.checked })} />
            Sync automatically when the app opens and after each session
          </label>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy || !passphrase} onClick={doSync}>
              {busy ? "Syncing…" : "Sync now"}
            </button>
            <span className="small muted">
              {status?.lastSyncAt ? `Last sync ${new Date(status.lastSyncAt).toLocaleString()} (${status.lastStatus}, v${status.remoteVersion})` : "Never synced on this device"}
            </span>
          </div>
        </div>
      )}
      {message && <p className="small">{message}</p>}
      <p className="small muted">Losing the passphrase means the cloud copy cannot be read; the data on each device stays usable and can be re-uploaded with a new passphrase.</p>
    </div>
  );
}
