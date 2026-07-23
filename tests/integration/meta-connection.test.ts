import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDatabase, type TestDb } from './setup';
import {
  importEnvConnectionOnce, resolveMetaCredentials, getMetaConnectionMeta, saveMetaConnection,
} from '../../integrations/providers/connection';
import { generateEncryptionKey } from '../../integrations/providers/secret-crypto';

describe('encrypted Meta connection storage', () => {
  let t: TestDb;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    t = await createTestDatabase('eh_meta_conn');
    for (const k of ['INTEGRATION_ENCRYPTION_KEY', 'META_PAGE_ACCESS_TOKEN', 'META_PAGE_ID', 'META_APP_SECRET', 'META_VERIFY_TOKEN', 'META_IG_USER_ID']) saved[k] = process.env[k];
    process.env.INTEGRATION_ENCRYPTION_KEY = generateEncryptionKey();
    process.env.META_PAGE_ACCESS_TOKEN = 'EAAB-env-page-token-1234';
    process.env.META_PAGE_ID = '111222333';
    process.env.META_APP_SECRET = 'env-app-secret-abcd';
    process.env.META_VERIFY_TOKEN = 'env-verify-token';
    process.env.META_IG_USER_ID = '999888777';
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await t.destroy();
  });

  it('imports valid env credentials into encrypted storage exactly once', async () => {
    expect(await importEnvConnectionOnce(t.db)).toBe(true);
    // Idempotent: a second call does nothing (a connection already exists).
    expect(await importEnvConnectionOnce(t.db)).toBe(false);

    // Stored ciphertext must NOT equal the plaintext token.
    const row = await t.db.selectFrom('provider_connections').select(['page_access_token_enc', 'page_id']).where('id', '=', 1).executeTakeFirst();
    expect(row?.page_access_token_enc).toBeTruthy();
    expect(row?.page_access_token_enc).not.toContain('EAAB-env-page-token-1234');
    expect(row?.page_id).toBe('111222333');
  });

  it('resolves plaintext credentials DB-first (decrypted) for runtime use', async () => {
    const creds = await resolveMetaCredentials(t.db);
    expect(creds.pageAccessToken).toBe('EAAB-env-page-token-1234');
    expect(creds.pageId).toBe('111222333');
    expect(creds.appSecret).toBe('env-app-secret-abcd');
    expect(creds.verifyToken).toBe('env-verify-token');
    expect(creds.igUserId).toBe('999888777');
  });

  it('never returns secret VALUES in the UI metadata — only masked tails', async () => {
    const meta = await getMetaConnectionMeta(t.db);
    expect(meta.hasPageToken).toBe(true);
    expect(meta.pageTokenTail).toBe('•••• 1234');
    expect(JSON.stringify(meta)).not.toContain('EAAB-env-page-token-1234');
    expect(JSON.stringify(meta)).not.toContain('env-app-secret-abcd');
  });

  it('a manual reconnect replaces the stored token and re-encrypts it', async () => {
    await saveMetaConnection(t.db, { pageAccessToken: 'EAAB-manual-9999', pageId: '111222333', source: 'manual', status: 'connected' });
    const creds = await resolveMetaCredentials(t.db);
    expect(creds.pageAccessToken).toBe('EAAB-manual-9999');
    const meta = await getMetaConnectionMeta(t.db);
    expect(meta.source).toBe('manual');
    expect(meta.pageTokenTail).toBe('•••• 9999');
  });
});
