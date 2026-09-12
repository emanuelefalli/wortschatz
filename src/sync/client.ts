// Glue between the UI and the sync engine: local configuration, provider
// construction, and the auto-sync hook. Configuration lives in localStorage;
// the passphrase is kept only where the learner chose (this device or this tab).

import type { FlashcardDB } from "../db/schema";
import { syncNow, type SyncResult } from "./engine";
import { getSupabaseClient, SupabaseProvider } from "./supabaseProvider";

export type SyncConfig = {
  provider: "supabase";
  url: string;
  anonKey: string;
  autoSync: boolean;
  rememberPassphrase: boolean;
};

const CONFIG_KEY = "wortschatz.sync.config";
const PASS_KEY = "wortschatz.sync.passphrase";

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as SyncConfig) : null;
  } catch {
    return null;
  }
}

export function saveSyncConfig(cfg: SyncConfig | null): void {
  try {
    if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function loadPassphrase(): string {
  try {
    return localStorage.getItem(PASS_KEY) ?? sessionStorage.getItem(PASS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function savePassphrase(passphrase: string, remember: boolean): void {
  try {
    localStorage.removeItem(PASS_KEY);
    sessionStorage.removeItem(PASS_KEY);
    if (!passphrase) return;
    (remember ? localStorage : sessionStorage).setItem(PASS_KEY, passphrase);
  } catch {
    /* ignore */
  }
}

/** Accept whatever the learner pastes (project URL, REST URL, dashboard URL) and reduce it to the project origin. */
export function normalizeSupabaseUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  try {
    const u = new URL(t.includes("://") ? t : `https://${t}`);
    // Dashboard links look like https://supabase.com/dashboard/project/<ref>/…
    const m = u.pathname.match(/\/project\/([a-z0-9]{15,})/);
    if (u.hostname.endsWith("supabase.com") && m) return `https://${m[1]}.supabase.co`;
    return u.origin;
  } catch {
    return t;
  }
}

export function getProvider(cfg: SyncConfig): SupabaseProvider {
  return new SupabaseProvider(getSupabaseClient({ url: normalizeSupabaseUrl(cfg.url), anonKey: cfg.anonKey.trim() }));
}

let inFlight: Promise<SyncResult | null> | null = null;

/** Run a sync if configured, signed in, and a passphrase is available. Never throws; returns null when skipped. */
export function autoSync(db: FlashcardDB, onError?: (message: string) => void): Promise<SyncResult | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const cfg = loadSyncConfig();
      const pass = loadPassphrase();
      if (!cfg || !cfg.autoSync || !pass || typeof navigator !== "undefined" && !navigator.onLine) return null;
      const provider = getProvider(cfg);
      if (!(await provider.isSignedIn())) return null;
      return await syncNow(db, provider, pass);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
