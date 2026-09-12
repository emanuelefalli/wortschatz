// Sync engine: download → decrypt → merge → write locally → encrypt → upload,
// with optimistic-concurrency retry. The passphrase never leaves the device.

import type { FlashcardDB } from "../db/schema";
import { SCHEMA_VERSION } from "../db/schema";
import { exportBackup, getActiveSession, getMeta, importBackup, saveSession, setMeta, type Backup } from "../db/repo";
import { decryptText, encryptText, type EncryptedBlob } from "./crypto";
import { contentSignature, mergeBackups } from "./merge";
import { SyncConflictError, type SyncProvider } from "./provider";

export type SyncResult = {
  status: "uploaded" | "downloaded" | "merged" | "unchanged";
  remoteVersion: number;
  at: string;
  /** Counts after the merge, for the status line. */
  reviews: number;
  words: number;
};

export const META_LAST_SYNC = "sync.lastSyncAt";
export const META_REMOTE_VERSION = "sync.remoteVersion";
export const META_LAST_STATUS = "sync.lastStatus";

async function parseRemote(payload: string, passphrase: string): Promise<Backup> {
  const blob = JSON.parse(payload) as EncryptedBlob;
  const json = await decryptText(blob, passphrase);
  const backup = JSON.parse(json) as Backup;
  if (backup.format !== "german-flashcards-backup") throw new Error("The cloud backup is not a Wortschatz backup.");
  if (backup.schemaVersion > SCHEMA_VERSION) throw new Error(`The cloud backup uses schema ${backup.schemaVersion}; update the app first.`);
  return backup;
}

export async function syncNow(db: FlashcardDB, provider: SyncProvider, passphrase: string, maxAttempts = 3): Promise<SyncResult> {
  if (!(await provider.isSignedIn())) throw new Error("Not signed in.");
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const remote = await provider.download();
      // Self-merge canonicalizes (drops row ids, fixes ordering) so equal content compares equal.
      const local = await exportBackup(db, SCHEMA_VERSION);
      const localCanon = mergeBackups(local, local);
      let merged: Backup;
      let status: SyncResult["status"];
      if (!remote) {
        merged = localCanon;
        status = "uploaded";
      } else {
        const remoteBackup = await parseRemote(remote.payload, passphrase);
        const remoteCanon = mergeBackups(remoteBackup, remoteBackup);
        merged = mergeBackups(localCanon, remoteCanon);
        const sig = contentSignature(merged);
        const sameAsRemote = sig === contentSignature(remoteCanon);
        const sameAsLocal = sig === contentSignature(localCanon);
        status = sameAsRemote && sameAsLocal ? "unchanged" : sameAsRemote ? "downloaded" : sameAsLocal ? "uploaded" : "merged";
        if (status !== "uploaded") {
          // The in-progress session on this device is never part of a backup; keep it across the import.
          const active = await getActiveSession(db);
          await importBackup(db, merged);
          if (active) await saveSession(db, active);
        }
        if (status === "unchanged" || status === "downloaded") {
          const at = new Date().toISOString();
          await setMeta(db, META_LAST_SYNC, at);
          await setMeta(db, META_REMOTE_VERSION, String(remote.version));
          await setMeta(db, META_LAST_STATUS, status);
          return { status, remoteVersion: remote.version, at, reviews: merged.reviewLog.length, words: merged.words.length };
        }
      }
      const payload = JSON.stringify(await encryptText(JSON.stringify(merged), passphrase));
      const up = await provider.upload(payload, remote?.version ?? null);
      await setMeta(db, META_LAST_SYNC, up.updatedAt);
      await setMeta(db, META_REMOTE_VERSION, String(up.version));
      await setMeta(db, META_LAST_STATUS, status);
      return { status, remoteVersion: up.version, at: up.updatedAt, reviews: merged.reviewLog.length, words: merged.words.length };
    } catch (e) {
      lastError = e;
      if (!(e instanceof SyncConflictError)) throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Sync failed after repeated conflicts.");
}

export async function getSyncStatus(db: FlashcardDB): Promise<{ lastSyncAt?: string; remoteVersion?: number; lastStatus?: string }> {
  const [lastSyncAt, v, lastStatus] = await Promise.all([getMeta(db, META_LAST_SYNC), getMeta(db, META_REMOTE_VERSION), getMeta(db, META_LAST_STATUS)]);
  return { lastSyncAt, remoteVersion: v ? Number(v) : undefined, lastStatus };
}
