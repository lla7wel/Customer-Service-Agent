import { getDb } from './supabase/db';
import type { DB } from '@integrations/db/client';

/**
 * Result wrapper used by every page so the UI can cleanly distinguish:
 *  - not connected   (DATABASE_URL missing)          → show setup card
 *  - connected, empty (fresh DB / no rows)           → show "no data yet"
 *  - connected, error (e.g. schema not applied yet)  → show error note
 *  - connected, rows                                 → render the data
 */
export interface QueryResult<T> {
  connected: boolean;
  error: string | null;
  rows: T[];
  count: number | null;
}

const NOT_CONNECTED = <T,>(): QueryResult<T> => ({
  connected: false,
  error: null,
  rows: [],
  count: null,
});

/**
 * Run a select with graceful degradation. `build` receives the Kysely
 * select-all builder for `table` so callers can add filters/order/limit.
 * `count` is the total matching rows before any limit (for pagination).
 */
export async function fetchRows<T>(
  table: keyof DB & string,
  build?: (q: any) => any,
): Promise<QueryResult<T>> {
  const db = getDb();
  if (!db) return NOT_CONNECTED<T>();

  try {
    let query: any = db.selectFrom(table).selectAll();
    if (build) query = build(query);
    const rows = (await query.execute()) as T[];
    const countRow = await query
      .clearSelect()
      .clearLimit()
      .clearOffset()
      .clearOrderBy()
      .select((eb: any) => eb.fn.countAll().as('n'))
      .executeTakeFirst();
    return { connected: true, error: null, rows, count: Number(countRow?.n ?? rows.length) };
  } catch (e: any) {
    return { connected: true, error: e?.message ?? 'Query failed', rows: [], count: null };
  }
}

/** Convenience: count rows in a table (for dashboard KPIs). */
export async function countRows(
  table: keyof DB & string,
  build?: (q: any) => any,
): Promise<{ connected: boolean; count: number | null; error: string | null }> {
  const db = getDb();
  if (!db) return { connected: false, count: null, error: null };
  try {
    let query: any = db.selectFrom(table);
    if (build) query = build(query);
    const row = await query.select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst();
    return { connected: true, count: Number(row?.n ?? 0), error: null };
  } catch (e: any) {
    return { connected: true, count: null, error: e?.message ?? 'Count failed' };
  }
}

/** Fetch a single row by id. */
export async function fetchOne<T>(
  table: keyof DB & string,
  id: string,
): Promise<{ connected: boolean; error: string | null; row: T | null }> {
  const db = getDb();
  if (!db) return { connected: false, error: null, row: null };
  try {
    const data = await (db.selectFrom(table) as any).selectAll().where('id', '=', id).executeTakeFirst();
    return { connected: true, error: null, row: (data as T) ?? null };
  } catch (e: any) {
    return { connected: true, error: e?.message ?? 'Query failed', row: null };
  }
}
