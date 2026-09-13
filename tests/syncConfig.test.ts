import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SYNC_CONFIG, isConfigured, loadSyncConfig, normalizeSupabaseUrl, resolveProject, saveSyncConfig, type SyncConfig } from "../src/sync/client";

const BUILT_IN = { url: "https://builtin.supabase.co", anonKey: "sb_publishable_builtin" };

describe("sync configuration", () => {
  beforeEach(() => localStorage.clear());

  it("falls back to the built-in project when nothing was typed on this device", () => {
    expect(resolveProject(DEFAULT_SYNC_CONFIG, BUILT_IN)).toEqual(BUILT_IN);
  });

  it("prefers a project typed on this device and normalises its URL", () => {
    const cfg: SyncConfig = { ...DEFAULT_SYNC_CONFIG, url: "https://mine.supabase.co/rest/v1/", anonKey: " sb_publishable_mine " };
    expect(resolveProject(cfg, BUILT_IN)).toEqual({ url: "https://mine.supabase.co", anonKey: "sb_publishable_mine" });
  });

  it("uses the built-in key when only the URL was left empty (and vice versa)", () => {
    expect(resolveProject({ ...DEFAULT_SYNC_CONFIG, anonKey: "k" }, BUILT_IN)).toEqual({ url: BUILT_IN.url, anonKey: "k" });
    expect(resolveProject({ ...DEFAULT_SYNC_CONFIG, url: "https://x.supabase.co" }, BUILT_IN)).toEqual({ url: "https://x.supabase.co", anonKey: BUILT_IN.anonKey });
  });

  it("is not configured when neither the device nor the build knows a key", () => {
    expect(resolveProject(DEFAULT_SYNC_CONFIG, { url: "https://x.supabase.co", anonKey: "" }).anonKey).toBe("");
    expect(isConfigured({ ...DEFAULT_SYNC_CONFIG, url: "https://x.supabase.co", anonKey: "k" })).toBe(true);
  });

  it("loads defaults when nothing is stored and merges partial stored configs", () => {
    expect(loadSyncConfig()).toEqual(DEFAULT_SYNC_CONFIG);
    localStorage.setItem("wortschatz.sync.config", JSON.stringify({ provider: "supabase", url: "https://a.supabase.co", anonKey: "k" }));
    expect(loadSyncConfig()).toEqual({ ...DEFAULT_SYNC_CONFIG, url: "https://a.supabase.co", anonKey: "k" });
    saveSyncConfig({ ...DEFAULT_SYNC_CONFIG, autoSync: false });
    expect(loadSyncConfig().autoSync).toBe(false);
  });

  it("reduces dashboard and REST links to the project origin", () => {
    expect(normalizeSupabaseUrl("https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/api")).toBe("https://abcdefghijklmnopqrst.supabase.co");
    expect(normalizeSupabaseUrl("abc.supabase.co/rest/v1")).toBe("https://abc.supabase.co");
  });
});
