import { describe, it, expect, beforeAll } from 'vitest';
import { encryptSecret, decryptSecret, maskTail, generateEncryptionKey, isEncryptionConfigured } from '../../integrations/providers/secret-crypto';
import {
  mergeSubscriptionFields,
  REQUIRED_IG_FIELDS,
  REQUIRED_PAGE_FIELDS,
  REQUIRED_SCOPES,
} from '../../integrations/providers/meta-connect';

describe('provider secret encryption (AES-256-GCM)', () => {
  beforeAll(() => { process.env.INTEGRATION_ENCRYPTION_KEY = generateEncryptionKey(); });

  it('round-trips a secret and never stores it in plaintext', () => {
    const secret = 'EAAB-super-secret-page-token-9f2a';
    const blob = encryptSecret(secret);
    expect(blob).toMatch(/^v1:/);
    expect(blob).not.toContain(secret); // ciphertext never contains the plaintext
    expect(decryptSecret(blob)).toBe(secret);
  });

  it('produces different ciphertext each time (random IV) but the same plaintext', () => {
    const a = encryptSecret('token');
    const b = encryptSecret('token');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('token');
    expect(decryptSecret(b)).toBe('token');
  });

  it('fails closed on tampering and on a wrong key', () => {
    const blob = encryptSecret('token');
    // Tamper the ciphertext payload.
    const tampered = blob.slice(0, -3) + (blob.endsWith('AAA') ? 'BBB' : 'AAA');
    expect(decryptSecret(tampered)).toBeNull();
    // Wrong key.
    const original = process.env.INTEGRATION_ENCRYPTION_KEY;
    process.env.INTEGRATION_ENCRYPTION_KEY = generateEncryptionKey();
    expect(decryptSecret(blob)).toBeNull();
    process.env.INTEGRATION_ENCRYPTION_KEY = original;
  });

  it('masks a secret to its last four characters only', () => {
    expect(maskTail('abcdefgh1234')).toBe('•••• 1234');
    expect(maskTail(null)).toBeNull();
  });

  it('reports unconfigured when the key is missing', () => {
    const original = process.env.INTEGRATION_ENCRYPTION_KEY;
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    expect(isEncryptionConfigured()).toBe(false);
    expect(decryptSecret(encryptSecretWith(original!, 'x'))).toBeNull(); // no key → cannot decrypt
    process.env.INTEGRATION_ENCRYPTION_KEY = original;
  });
});

// Encrypt using a specific key, then restore — helper for the missing-key test.
function encryptSecretWith(key: string, plaintext: string): string {
  const saved = process.env.INTEGRATION_ENCRYPTION_KEY;
  process.env.INTEGRATION_ENCRYPTION_KEY = key;
  const blob = encryptSecret(plaintext);
  process.env.INTEGRATION_ENCRYPTION_KEY = saved;
  return blob;
}

describe('webhook subscription field merge', () => {
  it('adds missing required fields without narrowing an existing subscription', () => {
    const { merged, missing } = mergeSubscriptionFields(['feed', 'ratings'], REQUIRED_PAGE_FIELDS);
    expect(missing).toEqual(['messages', 'messaging_postbacks']); // feed already present
    expect(merged).toEqual(expect.arrayContaining(['feed', 'ratings', 'messages', 'messaging_postbacks']));
    expect(merged).toContain('ratings'); // pre-existing extra field preserved
  });

  it('reports nothing missing when all required fields are present', () => {
    const { missing } = mergeSubscriptionFields([...REQUIRED_IG_FIELDS, 'story_insights'], REQUIRED_IG_FIELDS);
    expect(missing).toEqual([]);
  });
});

describe('Meta OAuth scopes', () => {
  it('requests the Page user-content permission required for Facebook comments', () => {
    expect(REQUIRED_SCOPES).toContain('pages_read_user_content');
  });
});
