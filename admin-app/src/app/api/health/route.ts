import { NextResponse } from 'next/server';
import { allIntegrationStatuses } from '@integrations/status';
import { pingDb } from '@integrations/db/client';
import { getDb } from '@integrations/db/client';
import { sql } from 'kysely';

export const runtime = 'nodejs';
// Must reflect runtime env (not be frozen at build time).
export const dynamic = 'force-dynamic';

/**
 * Machine-readable health. `configured` means the env is present; `database`
 * and `worker` are PROVEN states (a real query / recent worker activity), so
 * this endpoint never implies a working dependency it has not tested.
 */
export async function GET() {
  const statuses = allIntegrationStatuses();
  const dbAlive = await pingDb();

  // Worker liveness: a running/recently finished job or a fresh lease.
  let workerRecentlyActive: boolean | null = null;
  if (dbAlive) {
    const db = getDb();
    if (db) {
      try {
        const res = await sql<{ alive: boolean }>`
          select exists (
            select 1 from jobs
            where updated_at > now() - interval '10 minutes'
          ) as alive
        `.execute(db);
        workerRecentlyActive = !!res.rows[0]?.alive;
      } catch {
        workerRecentlyActive = null;
      }
    }
  }

  return NextResponse.json({
    ok: dbAlive,
    app: process.env.NEXT_PUBLIC_APP_NAME || 'EH-SYSTEM1',
    database: { alive: dbAlive },
    worker: { recently_active: workerRecentlyActive },
    integrations: statuses.reduce(
      (acc, s) => ({ ...acc, [s.key]: { configured: s.configured, missing: s.missing } }),
      {} as Record<string, { configured: boolean; missing: string[] }>,
    ),
  }, { status: dbAlive ? 200 : 503 });
}
