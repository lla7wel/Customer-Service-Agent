import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { createTestDatabase, type TestDb } from './setup';

const MIGRATION = path.resolve(__dirname, '../../database/migrations/0026_four_role_rbac.sql');

/**
 * Verifies migration 0026's data mapping and the four-role CHECK constraint by
 * reproducing the pre-migration ('admin' + full_access) state and re-running the
 * migration file (it is idempotent, so re-running is safe).
 */
describe('0026 four-role RBAC migration', () => {
  let t: TestDb;
  let client: Client;

  beforeAll(async () => {
    t = await createTestDatabase('eh_rbac_mig');
    client = new Client({ connectionString: t.url });
    await client.connect();

    // Reproduce the legacy shape: drop the four-role constraint and seed the
    // two-tier rows exactly as they existed before 0026.
    await client.query('alter table admin_accounts drop constraint if exists admin_accounts_role_check');
    await client.query(`
      insert into admin_accounts (username, password_hash, role, full_access) values
        ('legacy_owner', 'x', 'owner', true),
        ('legacy_full',  'x', 'admin', true),
        ('legacy_limited','x', 'admin', false)`);

    // Re-run the real migration file.
    await client.query(readFileSync(MIGRATION, 'utf8'));
  });

  afterAll(async () => { await client.end(); await t.destroy(); });

  it('maps legacy accounts preserving access (owner stays owner; full→owner; limited→messager)', async () => {
    const rows = await client.query(
      `select username, role from admin_accounts where username like 'legacy_%' order by username`,
    );
    const byUser = Object.fromEntries(rows.rows.map((r) => [r.username, r.role]));
    expect(byUser.legacy_owner).toBe('owner');
    expect(byUser.legacy_full).toBe('owner');
    expect(byUser.legacy_limited).toBe('messager');
  });

  it('installs a CHECK constraint accepting the four roles and rejecting others', async () => {
    for (const role of ['owner', 'analyzer', 'poster', 'messager']) {
      await expect(
        client.query(`insert into admin_accounts (username, password_hash, role) values ('ok_${role}', 'x', '${role}')`),
      ).resolves.toBeTruthy();
    }
    await expect(
      client.query(`insert into admin_accounts (username, password_hash, role) values ('bad', 'x', 'admin')`),
    ).rejects.toThrow(/admin_accounts_role_check/);
  });

  it('is idempotent — a second run changes nothing and keeps the constraint', async () => {
    await expect(client.query(readFileSync(MIGRATION, 'utf8'))).resolves.toBeTruthy();
    const rows = await client.query(`select role from admin_accounts where username = 'legacy_full'`);
    expect(rows.rows[0].role).toBe('owner');
  });
});
