import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestDatabase, type TestDb } from './setup';

const SECRET = 'test-session-secret-with-at-least-32-characters';

describe('authentication', () => {
  let t: TestDb;
  let auth: typeof import('../../admin-app/src/lib/auth');
  let edge: typeof import('../../admin-app/src/lib/auth-edge');

  beforeAll(async () => {
    t = await createTestDatabase('eh_auth');
    process.env.DATABASE_URL = t.url;
    process.env.SESSION_SECRET = SECRET;
    edge = await import('../../admin-app/src/lib/auth-edge');
    auth = await import('../../admin-app/src/lib/auth');
  });
  afterAll(async () => {
    // requireAdmin() uses the shared cached pool from integrations/db/client —
    // close it before the database is dropped.
    const { getDb } = await import('../../integrations/db/client');
    await getDb()?.destroy().catch(() => {});
    delete process.env.SESSION_SECRET;
    delete process.env.DATABASE_URL;
    await t.destroy();
  });

  it('FAILS CLOSED without SESSION_SECRET (EH-012)', () => {
    const saved = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    expect(edge.isAuthConfigured()).toBe(false);
    process.env.SESSION_SECRET = 'too-short';
    expect(edge.isAuthConfigured()).toBe(false); // <32 chars is rejected too
    process.env.SESSION_SECRET = saved;
    expect(edge.isAuthConfigured()).toBe(true);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await edge.signSessionJwt('admin-1', 'sess-1', 'owner');
    process.env.SESSION_SECRET = 'a-completely-different-secret-32-chars!!';
    expect(await edge.verifySessionToken(token!)).toBeNull();
    process.env.SESSION_SECRET = SECRET;
    expect(await edge.verifySessionToken(token!)).toMatchObject({ adminId: 'admin-1', sessionId: 'sess-1' });
  });

  it('rejects garbage and empty tokens', async () => {
    expect(await edge.verifySessionToken(undefined)).toBeNull();
    expect(await edge.verifySessionToken('not.a.jwt')).toBeNull();
  });

  it('creates a DB-backed session that requireAdmin accepts', async () => {
    const admin = await t.db.insertInto('admin_accounts').values({
      username: 'owner', display_name: 'Owner', password_hash: await bcrypt.hash('a-strong-password', 4),
      role: 'owner', full_access: true,
    }).returning(['id', 'username']).executeTakeFirst();

    const token = await auth.createSession(t.db, { id: admin!.id, username: admin!.username });
    expect(token).toBeTruthy();
    const ctx = await auth.requireAdmin(token!);
    expect(ctx).toMatchObject({ username: 'owner', role: 'owner', fullAccess: true });
  });

  it('REVOCATION: a revoked session is rejected immediately', async () => {
    const admin = await t.db.selectFrom('admin_accounts').select(['id', 'username']).where('username', '=', 'owner').executeTakeFirst();
    const token = await auth.createSession(t.db, { id: admin!.id, username: admin!.username });
    const parsed = await edge.verifySessionToken(token!);
    await auth.revokeSession(t.db, parsed!.sessionId);
    expect(await auth.requireAdmin(token!)).toBeNull();
  });

  it('a DISABLED admin loses access even with a valid token', async () => {
    const admin = await t.db.insertInto('admin_accounts').values({
      username: 'temp_admin', password_hash: await bcrypt.hash('another-strong-pass', 4), role: 'admin',
    }).returning(['id', 'username']).executeTakeFirst();
    const token = await auth.createSession(t.db, { id: admin!.id, username: admin!.username });
    expect(await auth.requireAdmin(token!)).not.toBeNull();
    await t.db.updateTable('admin_accounts').set({ is_active: false }).where('id', '=', admin!.id).execute();
    expect(await auth.requireAdmin(token!)).toBeNull();
  });

  it('RATE LIMITING blocks brute force after repeated failures (EH-020)', async () => {
    const ip = '203.0.113.9';
    expect(await auth.isLoginRateLimited(t.db, ip, 'victim')).toBe(false);
    for (let i = 0; i < 5; i++) await auth.recordLoginAttempt(t.db, ip, 'victim', false);
    expect(await auth.isLoginRateLimited(t.db, ip, 'victim')).toBe(true);
    // A different IP AND username is unaffected.
    expect(await auth.isLoginRateLimited(t.db, '198.51.100.7', 'someone_else')).toBe(false);
  });

  it('records individual admin audit entries even for equal-access admins', async () => {
    const admin = await t.db.selectFrom('admin_accounts').select(['id', 'username']).where('username', '=', 'owner').executeTakeFirst();
    await auth.audit(t.db, { id: admin!.id, username: admin!.username }, 'price.change', { type: 'product', id: 'p1', detail: { new_price: 10 } });
    const row = await t.db.selectFrom('admin_audit_log')
      .select(['admin_username', 'action', 'entity_type']).orderBy('id', 'desc').executeTakeFirst();
    expect(row).toMatchObject({ admin_username: 'owner', action: 'price.change', entity_type: 'product' });
  });

  it('password hashes are bcrypt and never stored in plain text', async () => {
    const row = await t.db.selectFrom('admin_accounts').select('password_hash').where('username', '=', 'owner').executeTakeFirst();
    expect(row!.password_hash).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare('a-strong-password', row!.password_hash)).toBe(true);
  });

  it('protects the LAST owner: the DB keeps at least one active owner', async () => {
    const owners = await t.db.selectFrom('admin_accounts').select('id')
      .where('role', '=', 'owner').where('is_active', '=', true).execute();
    expect(owners.length).toBeGreaterThanOrEqual(1);
  });
});
