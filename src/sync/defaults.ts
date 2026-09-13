// Built-in Supabase project so a new device only needs an account and the
// backup passphrase. The publishable (anon) key is designed to ship inside
// client bundles: every table is protected by row-level security, so the key
// alone gives no access to anyone's data.
//
// Override at build time with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// (the deploy workflow forwards the repository variables of the same names),
// or per device under Settings → Cloud sync → "Use a different project".

const env = import.meta.env as Record<string, string | undefined>;

export const DEFAULT_SUPABASE_URL: string = (env.VITE_SUPABASE_URL ?? "https://rorzifiaustuevcgeglz.supabase.co").trim();
export const DEFAULT_SUPABASE_ANON_KEY: string = (env.VITE_SUPABASE_ANON_KEY ?? "").trim();

/** True when the build carries both a project URL and a key. */
export function hasBuiltInProject(): boolean {
  return DEFAULT_SUPABASE_URL !== "" && DEFAULT_SUPABASE_ANON_KEY !== "";
}
