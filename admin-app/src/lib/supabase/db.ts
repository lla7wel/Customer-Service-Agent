import 'server-only';
import { getDb as getKyselyDb } from '@integrations/db/client';

/**
 * Server-side database handle. SERVER COMPONENTS / ROUTE HANDLERS ONLY —
 * `server-only` makes a client-component import a build error, keeping
 * DATABASE_URL access off the browser bundle.
 *
 * Returns null when DATABASE_URL isn't set so callers can show "not connected".
 */
export function getDb() {
  return getKyselyDb();
}
