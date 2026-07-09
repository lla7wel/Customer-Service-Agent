import { Kysely, PostgresDialect, sql } from 'kysely';
import pg, { Pool } from 'pg';
import { env } from '../env';
import type { DB } from './types';

/**
 * Direct Postgres access via Kysely. SERVER / SCRIPTS ONLY.
 *
 * Returns null when DATABASE_URL is unset so callers can show "not connected"
 * instead of crashing — same contract the Supabase admin client had.
 *
 * Rows keep the shapes the app was written against when it spoke PostgREST
 * (JSON over HTTP): timestamps are ISO strings, numeric is number, bigint
 * counts are number. db/types.ts is patched to match (see npm run db:codegen).
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => parseFloat(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (v) => new Date(v + 'Z').toISOString());

let cached: Kysely<DB> | null = null;

export function getDb(): Kysely<DB> | null {
  const url = env('DATABASE_URL');
  if (!url) return null;
  if (cached) return cached;
  cached = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: url, max: 10 }),
    }),
  });
  return cached;
}

/** Throwing variant for scripts that cannot proceed without a database. */
export function requireDb(): Kysely<DB> {
  const db = getDb();
  if (!db) throw new Error('Database is not configured. Set DATABASE_URL.');
  return db;
}

/** Lightweight connectivity probe used by the health check. */
export async function pingDb(): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    await sql`select 1`.execute(db);
    return true;
  } catch {
    return false;
  }
}

export type { DB } from './types';
export { sql } from 'kysely';
export type { Kysely } from 'kysely';
