// Supabase backend: email + password auth, one `backups` row per user,
// protected by row-level security. See README "Cloud sync" for the SQL.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SyncConflictError, type RemoteBlob, type SyncProvider } from "./provider";

export type SupabaseConfig = { url: string; anonKey: string };

let cached: { key: string; client: SupabaseClient } | null = null;

export function getSupabaseClient(cfg: SupabaseConfig): SupabaseClient {
  const key = `${cfg.url}|${cfg.anonKey}`;
  if (cached?.key !== key) cached = { key, client: createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } }) };
  return cached.client;
}

export class SupabaseProvider implements SyncProvider {
  readonly kind = "supabase";
  constructor(private client: SupabaseClient) {}

  async isSignedIn(): Promise<boolean> {
    const { data } = await this.client.auth.getSession();
    return !!data.session;
  }

  async userEmail(): Promise<string | undefined> {
    const { data } = await this.client.auth.getUser();
    return data.user?.email ?? undefined;
  }

  async signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw error;
    return { needsConfirmation: !data.session };
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  private async userId(): Promise<string> {
    const { data } = await this.client.auth.getUser();
    if (!data.user) throw new Error("Not signed in.");
    return data.user.id;
  }

  async download(): Promise<RemoteBlob | null> {
    const uid = await this.userId();
    const { data, error } = await this.client.from("backups").select("payload, version, updated_at").eq("user_id", uid).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { payload: data.payload as string, version: data.version as number, updatedAt: data.updated_at as string };
  }

  async upload(payload: string, expectedVersion: number | null): Promise<{ version: number; updatedAt: string }> {
    const uid = await this.userId();
    const updatedAt = new Date().toISOString();
    if (expectedVersion === null) {
      const { error } = await this.client.from("backups").insert({ user_id: uid, payload, version: 1, updated_at: updatedAt });
      if (error) {
        if (error.code === "23505") throw new SyncConflictError(); // row already exists
        throw error;
      }
      return { version: 1, updatedAt };
    }
    const next = expectedVersion + 1;
    const { data, error } = await this.client
      .from("backups")
      .update({ payload, version: next, updated_at: updatedAt })
      .eq("user_id", uid)
      .eq("version", expectedVersion)
      .select("version");
    if (error) throw error;
    if (!data || data.length === 0) throw new SyncConflictError();
    return { version: next, updatedAt };
  }
}

/** SQL to run once in the Supabase SQL editor. */
export const SUPABASE_SETUP_SQL = `create table if not exists public.backups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload text not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.backups enable row level security;
create policy "own backup" on public.backups
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);`;
