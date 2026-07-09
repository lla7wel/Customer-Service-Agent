import { getDb } from './supabase/db';
import { supabaseStatus } from '@integrations/status';

/**
 * Result wrapper used by every page so the UI can cleanly distinguish:
 *  - not connected   (Supabase env missing)        → show setup card
 *  - connected, empty (fresh DB / no rows)          → show "no data yet"
 *  - connected, error (e.g. schema not applied yet) → show error note
 *  - connected, rows                                → render the data
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
 * Run a Supabase select with graceful degradation. `build` receives the
 * `.from(table)` query builder so callers can add filters/order/limit.
 */
export async function fetchRows<T>(
  table: string,
  build?: (q: any) => any,
): Promise<QueryResult<T>> {
  if (!supabaseStatus().configured) return NOT_CONNECTED<T>();
  const supabase = getDb();
  if (!supabase) return NOT_CONNECTED<T>();

  try {
    let query: any = supabase.from(table).select('*', { count: 'exact' });
    if (build) query = build(query);
    const { data, error, count } = await query;
    if (error) {
      return { connected: true, error: error.message, rows: [], count: null };
    }
    return { connected: true, error: null, rows: (data ?? []) as T[], count: count ?? null };
  } catch (e: any) {
    return { connected: true, error: e?.message ?? 'Query failed', rows: [], count: null };
  }
}

/** Convenience: count rows in a table (for dashboard KPIs). */
export async function countRows(
  table: string,
  build?: (q: any) => any,
): Promise<{ connected: boolean; count: number | null; error: string | null }> {
  if (!supabaseStatus().configured) return { connected: false, count: null, error: null };
  const supabase = getDb();
  if (!supabase) return { connected: false, count: null, error: null };
  try {
    let query: any = supabase.from(table).select('id', { count: 'exact', head: true });
    if (build) query = build(query);
    const { count, error } = await query;
    if (error) return { connected: true, count: null, error: error.message };
    return { connected: true, count: count ?? 0, error: null };
  } catch (e: any) {
    return { connected: true, count: null, error: e?.message ?? 'Count failed' };
  }
}

/** Fetch a single row by id. */
export async function fetchOne<T>(
  table: string,
  id: string,
): Promise<{ connected: boolean; error: string | null; row: T | null }> {
  if (!supabaseStatus().configured) return { connected: false, error: null, row: null };
  const supabase = getDb();
  if (!supabase) return { connected: false, error: null, row: null };
  try {
    const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
    if (error) return { connected: true, error: error.message, row: null };
    return { connected: true, error: null, row: (data as T) ?? null };
  } catch (e: any) {
    return { connected: true, error: e?.message ?? 'Query failed', row: null };
  }
}
