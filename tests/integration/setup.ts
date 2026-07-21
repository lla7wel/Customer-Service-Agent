/**
 * Integration-test harness: each run creates a throwaway Postgres database,
 * applies the FULL migration chain through the real runner, and tears it down.
 *
 * Connection: TEST_DATABASE_ADMIN_URL (default postgres://localhost/postgres).
 */
import { Client } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import pgPkg from 'pg';
import { migrate } from '../../scripts/migrate';
import type { DB } from '../../integrations/db/types';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL || 'postgres://localhost/postgres';

pgPkg.types.setTypeParser(pgPkg.types.builtins.NUMERIC, (v) => parseFloat(v));
pgPkg.types.setTypeParser(pgPkg.types.builtins.INT8, (v) => Number(v));
pgPkg.types.setTypeParser(pgPkg.types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());

export interface TestDb {
  name: string;
  url: string;
  db: Kysely<DB>;
  destroy: () => Promise<void>;
}

export async function createTestDatabase(prefix = 'eh_test'): Promise<TestDb> {
  const name = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = ADMIN_URL.replace(/\/[^/]*$/, `/${name}`);
  await migrate({ databaseUrl: url, quiet: true });

  const pool = new pgPkg.Pool({ connectionString: url, max: 5 });
  // Force-dropping the database at teardown terminates any lingering server
  // connection; swallow the resulting async error instead of crashing vitest.
  pool.on('error', () => {});
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  });

  return {
    name,
    url,
    db,
    destroy: async () => {
      await db.destroy();
      const adm = new Client({ connectionString: ADMIN_URL });
      await adm.connect();
      await adm.query(`drop database if exists ${name} with (force)`);
      await adm.end();
    },
  };
}

/** Seed one active priced product; returns its id. */
export async function seedProduct(db: Kysely<DB>, over: Partial<Record<string, unknown>> = {}): Promise<string> {
  const row = await db
    .insertInto('products')
    .values({
      product_code: `T${Math.random().toString(36).slice(2, 10)}`,
      english_name: 'Test Duvet Set 160x220 White',
      arabic_name: 'طقم غطاء لحاف',
      base_price: 250,
      active_price: 250,
      status: 'active',
      source: 'csv',
      ...(over as any),
    })
    .returning('id')
    .executeTakeFirst();
  return row!.id;
}

/** Seed a customer + active conversation; returns ids. */
export async function seedConversation(db: Kysely<DB>, channel: 'messenger' | 'instagram' = 'messenger') {
  const customer = await db
    .insertInto('customers')
    .values({ channel, external_id: `psid_${Math.random().toString(36).slice(2, 10)}` })
    .returning(['id', 'external_id'])
    .executeTakeFirst();
  const convo = await db
    .insertInto('conversations')
    .values({ customer_id: customer!.id, channel, status: 'ai_handling', ai_enabled: true })
    .returning('id')
    .executeTakeFirst();
  return { customerId: customer!.id, externalId: customer!.external_id!, conversationId: convo!.id };
}
