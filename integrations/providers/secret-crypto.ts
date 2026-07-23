/**
 * Authenticated encryption for provider secrets at rest (AES-256-GCM).
 *
 * Stored access tokens, app secrets and verify tokens are ALWAYS encrypted with
 * a deployment-level key (`INTEGRATION_ENCRYPTION_KEY`, 32 bytes as hex or
 * base64). Plaintext secrets never touch the database, logs, API responses or
 * the browser — the UI only ever sees masked endings (see `maskTail`).
 *
 * Ciphertext format: `v1:<base64(iv[12] | tag[16] | ciphertext)>`.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_LEN = 12;
const TAG_LEN = 16;

/** The 32-byte key, or null when unconfigured (treated as "no secure store"). */
export function encryptionKey(): Buffer | null {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) return null;
  const t = raw.trim();
  // Accept 64-hex or base64 (44 chars for 32 bytes). Fall back to utf8 length 32.
  if (/^[0-9a-fA-F]{64}$/.test(t)) return Buffer.from(t, 'hex');
  try {
    const b = Buffer.from(t, 'base64');
    if (b.length === 32) return b;
  } catch { /* not base64 */ }
  if (Buffer.byteLength(t, 'utf8') === 32) return Buffer.from(t, 'utf8');
  return null;
}

export function isEncryptionConfigured(): boolean {
  return encryptionKey() !== null;
}

/** Generate a fresh 32-byte key as hex (for safe deploy-time provisioning). */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}

export function encryptSecret(plaintext: string): string {
  const key = encryptionKey();
  if (!key) throw new Error('INTEGRATION_ENCRYPTION_KEY is not configured — cannot store provider secrets.');
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ct]).toString('base64')}`;
}

/** Decrypt, or return null if the key is missing / blob is malformed / tampered. */
export function decryptSecret(blob: string | null | undefined): string | null {
  if (!blob) return null;
  const key = encryptionKey();
  if (!key) return null;
  const [version, payload] = blob.split(':', 2);
  if (version !== VERSION || !payload) return null;
  try {
    const buf = Buffer.from(payload, 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null; // wrong key or tampered ciphertext
  }
}

/** Safe display: last `keep` characters only (e.g. "•••• 8f2a"). Never the value. */
export function maskTail(plaintext: string | null | undefined, keep = 4): string | null {
  if (!plaintext) return null;
  const tail = plaintext.slice(-keep);
  return `•••• ${tail}`;
}
