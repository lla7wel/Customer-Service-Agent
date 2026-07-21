import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/api';
import { runAllReadinessChecks } from '@integrations/providers/readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Last recorded truthful readiness results (a missing row = never checked). */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db } = auth.ctx;
  const checks = await db.selectFrom('provider_readiness')
    .select(['check_key', 'ok', 'summary', 'detail', 'checked_at'])
    .orderBy('check_key', 'asc')
    .execute();
  return NextResponse.json({ checks });
}

/** Run every readiness check now (real provider calls; results persisted). */
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db } = auth.ctx;
  const results = await runAllReadinessChecks(db);
  return NextResponse.json({ ok: true, results });
}
