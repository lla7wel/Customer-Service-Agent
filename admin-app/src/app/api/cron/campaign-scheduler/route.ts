/**
 * Campaign scheduler HTTP trigger — protected by CLOUDFLARE_WEBHOOK_SECRET.
 * Runs the same tick as the Cloudflare cron Worker: refreshes product pricing
 * and auto-publishes any due scheduled campaigns.
 * Must not: remove the auth check (the route would be publicly triggerable).
 * Called by: Cloudflare cron worker, external cron, or manual test via curl.
 * Calls: integrations/pipelines/campaign.runSchedulerTick.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@integrations/supabase/admin-client';
import { runSchedulerTick } from '@integrations/pipelines/campaign';
import { envAny } from '@integrations/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Campaign scheduler tick: refresh cached pricing + auto-publish due campaigns.
 * Protected by CLOUDFLARE_WEBHOOK_SECRET (Authorization: Bearer <secret>).
 * Trigger via the Cloudflare cron worker, an external cron, or manually while
 * testing. Returns 503 if the secret isn't set (so it can't run unprotected).
 */
async function handle(req: NextRequest) {
  const secret = envAny('CLOUDFLARE_WEBHOOK_SECRET');
  if (!secret) {
    return NextResponse.json({ error: 'integration_not_configured', missing: ['CLOUDFLARE_WEBHOOK_SECRET'] }, { status: 503 });
  }
  const auth = req.headers.get('authorization') || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : req.nextUrl.searchParams.get('secret');
  if (provided !== secret) return new NextResponse('Unauthorized', { status: 401 });

  const db = adminClient();
  if (!db) {
    return NextResponse.json({ error: 'integration_not_configured', missing: ['SUPABASE_SERVICE_ROLE_KEY'] }, { status: 503 });
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
