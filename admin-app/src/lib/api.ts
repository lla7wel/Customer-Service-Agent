/**
 * Shared API-route helpers: authenticated admin context + JSON error shapes.
 * Every mutating admin API goes through requireAdminApi so revoked sessions
 * and disabled accounts are enforced at the data layer, not just middleware.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { Kysely } from 'kysely';
import type { DB } from '@integrations/db/types';
import { getDb } from '@integrations/db/client';
import { requireAdmin, SESSION_COOKIE, type AdminContext } from '@/lib/auth';

export type ApiContext = { db: Kysely<DB>; admin: AdminContext };

export async function requireAdminApi(req: NextRequest): Promise<
  { ok: true; ctx: ApiContext } | { ok: false; res: NextResponse }
> {
  const db = getDb();
  if (!db) {
    return { ok: false, res: NextResponse.json({ error: 'database_not_configured' }, { status: 503 }) };
  }
  const devBypass = process.env.NODE_ENV !== 'production' && process.env.AUTH_DISABLED_DEV === 'true';
  if (devBypass) {
    return {
      ok: true,
      ctx: {
        db,
        admin: { id: '00000000-0000-0000-0000-000000000000', username: 'dev', displayName: 'Dev', role: 'owner', fullAccess: true, sessionId: 'dev' },
      },
    };
  }
  const admin = await requireAdmin(req.cookies.get(SESSION_COOKIE)?.value);
  if (!admin) {
    return { ok: false, res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  return { ok: true, ctx: { db, admin } };
}

export function badRequest(error: string, detail?: string): NextResponse {
  return NextResponse.json({ error, ...(detail ? { detail } : {}) }, { status: 400 });
}

export function notFound(error = 'not_found'): NextResponse {
  return NextResponse.json({ error }, { status: 404 });
}

export function forbidden(detail?: string): NextResponse {
  return NextResponse.json({ error: 'forbidden', ...(detail ? { detail } : {}) }, { status: 403 });
}
