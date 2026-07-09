/**
 * Campaign scheduler HTTP trigger — protected by CRON_SECRET.
 * Refreshes cached product pricing and auto-publishes due scheduled campaigns.
 * Must not: remove the auth check (the route would be publicly triggerable).
 * Called by: the host crontab (curl) or a manual test.
 * Calls: integrations/pipelines/campaign.runSchedulerTick.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@integrations/db/client';
import { runSchedulerTick } from '@integrations/pipelines/campaign';
import { envAny } from '@integrations/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Campaign scheduler tick: refresh cached pricing + auto-publish due campaigns.
 * Protected by CRON_SECRET (Authorization: Bearer <secret>).
 * Returns 503 if the secret isn't set (so it can't run unprotected).
 */
async function handle(req: NextRequest) {
  const secret = envAny('CRON_SECRET', 'CLOUDFLARE_WEBHOOK_SECRET');
  if (!secret) {
    return NextResponse.json({ error: 'integration_not_configured', missing: ['CRON_SECRET'] }, { status: 503 });
  }
  const auth = req.headers.get('authorization') || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : req.nextUrl.searchParams.get('secret');
  if (provided !== secret) return new NextResponse('Unauthorized', { status: 401 });

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'integration_not_configured', missing: ['DATABASE_URL'] }, { status: 503 });
  }
  const result = await runSchedulerTick(db);
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(req: NextRequest) {
  return handle(req);
}
export async function GET(req: NextRequest) {
  return handle(req);
}
