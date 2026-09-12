// Client-side encryption for cloud backups: AES-256-GCM with a key derived
// from the learner's passphrase (PBKDF2-SHA256). The server only ever sees
// ciphertext. Uses WebCrypto, available in browsers and Node 20+.

export type EncryptedBlob = {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  data: string; // base64 ciphertext (includes GCM tag)
};

const ITERATIONS = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto is not available in this environment.");
  return c.subtle;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", enc.encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptText(plaintext: string, passphrase: string): Promise<EncryptedBlob> {
  if (!passphrase) throw new Error("A passphrase is required.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const data = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, enc.encode(plaintext)));
  return { v: 1, kdf: "PBKDF2-SHA256", iterations: ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(data) };
}

export class WrongPassphraseError extends Error {
  constructor() {
    super("The backup could not be decrypted. Check the passphrase.");
    this.name = "WrongPassphraseError";
  }
}

export async function decryptText(blob: EncryptedBlob, passphrase: string): Promise<string> {
  if (blob.v !== 1) throw new Error(`Unsupported backup encryption version ${String(blob.v)}`);
  const key = await deriveKey(passphrase, fromBase64(blob.salt), blob.iterations);
  try {
    const plain = await subtle().decrypt({ name: "AES-GCM", iv: fromBase64(blob.iv) as BufferSource }, key, fromBase64(blob.data) as BufferSource);
    return dec.decode(plain);
  } catch {
    throw new WrongPassphraseError();
  }
}
