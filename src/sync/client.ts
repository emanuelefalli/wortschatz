// Glue between the UI and the sync engine: local configuration, provider
// construction, and the auto-sync hook. Configuration lives in localStorage;
// the passphrase is kept only where the learner chose (this device or this tab).

import type { FlashcardDB } from "../db/schema";
import { syncNow, type SyncResult } from "./engine";
import { DEFAULT_SUPABASE_ANON_KEY, DEFAULT_SUPABASE_URL } from "./defaults";
import { getSupabaseClient, SupabaseProvider } from "./supabaseProvider";

export type SyncConfig = {
  provider: "supabase";
  /** Project URL typed on this device; empty = use the project built into the app. */
  url: string;
  /** Publishable key typed on this device; empty = use the key built into the app. */
  anonKey: string;
  autoSync: boolean;
  rememberPassphrase: boolean;
};

export const DEFAULT_SYNC_CONFIG: SyncConfig = { provider: "supabase", url: "", anonKey: "", autoSync: true, rememberPassphrase: true };

const CONFIG_KEY = "wortschatz.sync.config";
const PASS_KEY = "wortschatz.sync.passphrase";

/** Stored per-device config, or the defaults when nothing was saved yet. */
export function loadSyncConfig(): SyncConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? { ...DEFAULT_SYNC_CONFIG, ...(JSON.parse(raw) as Partial<SyncConfig>) } : { ...DEFAULT_SYNC_CONFIG };
  } catch {
    return { ...DEFAULT_SYNC_CONFIG };
  }
}

export function saveSyncConfig(cfg: SyncConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    /* storage unavailable */
  }
}

/** The project this device actually talks to: what was typed here, else what the build carries. */
export function resolveProject(cfg: SyncConfig, defaults: { url: string; anonKey: string } = { url: DEFAULT_SUPABASE_URL, anonKey: DEFAULT_SUPABASE_ANON_KEY }): { url: string; anonKey: string } {
  const url = normalizeSupabaseUrl(cfg.url) || defaults.url;
  const anonKey = cfg.anonKey.trim() || defaults.anonKey;
  return { url, anonKey };
}

/** Whether a sync provider can be built at all (a project URL and key are known). */
export function isConfigured(cfg: SyncConfig): boolean {
  const p = resolveProject(cfg);
  return p.url !== "" && p.anonKey !== "";
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
  const project = resolveProject(cfg);
  if (!project.url || !project.anonKey) throw new Error("Cloud sync is not set up: no Supabase project URL or key.");
  return new SupabaseProvider(getSupabaseClient(project));
}

let inFlight: Promise<SyncResult | null> | null = null;

/** Run a sync if configured, signed in, and a passphrase is available. Never throws; returns null when skipped. */
export function autoSync(db: FlashcardDB, onError?: (message: string) => void): Promise<SyncResult | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const cfg = loadSyncConfig();
      const pass = loadPassphrase();
      if (!cfg.autoSync || !pass || !isConfigured(cfg) || (typeof navigator !== "undefined" && !navigator.onLine)) return null;
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
