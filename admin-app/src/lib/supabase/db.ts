import 'server-only';
import { adminClient } from '@integrations/supabase/admin-client';

/**
 * Server-side data client (service role). SERVER COMPONENTS / ROUTE HANDLERS ONLY.
 *
 * Why this exists: the database has RLS enabled with policies that only grant
 * access to the `authenticated` role. The cookie-bound anon client
 * (getServerSupabase) therefore returns ZERO rows for an unauthenticated admin —
 * which is exactly why "/products" showed "No products yet" while the DB held
 * 4,777 rows. This single-admin, local control center reads through the
 * service-role key (never exposed to the browser — no NEXT_PUBLIC prefix) so the
 * admin UI always sees the real data. Auth (getServerSupabase) is still used for
 * the signed-in user's identity.
 *
 * Returns null when Supabase isn't configured so callers can show "not connected".
 */
export function getDb() {
  return adminClient();
}
