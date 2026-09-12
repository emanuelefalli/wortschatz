// Storage backend for the encrypted backup blob. One row per account with
// optimistic concurrency: uploads must name the version they are replacing.

export type RemoteBlob = { payload: string; version: number; updatedAt: string };

export class SyncConflictError extends Error {
  constructor() {
    super("The cloud backup changed while syncing. Retrying.");
    this.name = "SyncConflictError";
  }
}

export interface SyncProvider {
  readonly kind: string;
  isSignedIn(): Promise<boolean>;
  /** null when the account has no backup yet. */
  download(): Promise<RemoteBlob | null>;
  /** expectedVersion null = create; throws SyncConflictError when the remote version differs. */
  upload(payload: string, expectedVersion: number | null): Promise<{ version: number; updatedAt: string }>;
}

/** In-memory provider for tests and for trying the flow without an account. */
export class MemoryProvider implements SyncProvider {
  readonly kind = "memory";
  private blob: RemoteBlob | null = null;
  constructor(private signedIn = true) {}
  async isSignedIn() {
    return this.signedIn;
  }
  async download() {
    return this.blob ? { ...this.blob } : null;
  }
  async upload(payload: string, expectedVersion: number | null) {
    const current = this.blob?.version ?? null;
    if (current !== expectedVersion) throw new SyncConflictError();
    const next = { payload, version: (current ?? 0) + 1, updatedAt: new Date().toISOString() };
    this.blob = next;
    return { version: next.version, updatedAt: next.updatedAt };
  }
}
