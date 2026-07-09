import { NextRequest, NextResponse } from 'next/server';
import {
  verifySubscription,
  verifyWebhookSignature,
  parseMessengerWebhook,
} from '@integrations/meta';
import { metaStatus } from '@integrations/status';
import { adminClient } from '@integrations/supabase/admin-client';
import { processMessengerEvents, runMessageBatchDebounce } from '@integrations/pipelines/messenger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Allow the inbound burst-debounce (≈8s) + the AI turn to complete before the
// serverless function is frozen.
export const maxDuration = 60;

/**
 * Meta webhook — the single Callback URL to register in the Meta App. Handles
 * Messenger messages (the comments feature has been removed).
 *
 * GET  = verification handshake: echoes hub.challenge as plain text iff
 *        hub.mode=subscribe and hub.verify_token === META_VERIFY_TOKEN.
 * POST = inbound events: verifies the X-Hub-Signature-256, then dispatches
 *        Messenger events to the pipeline.
 */
export async function GET(req: NextRequest) {
  if (!metaStatus().configured) {
    return NextResponse.json({ error: 'integration_not_configured', missing: metaStatus().missing }, { status: 503 });
  }
  const { ok, challenge } = verifySubscription(req.nextUrl.searchParams);
  if (ok && challenge !== undefined) {
    // Meta requires the raw challenge string back as text/plain.
    return new NextResponse(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

export async function POST(req: NextRequest) {
  if (!metaStatus().configured) {
    return NextResponse.json({ error: 'integration_not_configured', missing: metaStatus().missing }, { status: 503 });
  }
  const raw = await req.text();
  const valid = await verifyWebhookSignature(raw, req.headers.get('x-hub-signature-256'));
  if (!valid) return new NextResponse('Invalid signature', { status: 401 });

  const db = adminClient();
  if (!db) {
    // Acknowledge so Meta does not retry forever, but note we can't persist.
    return NextResponse.json({ ok: true, stored: false, reason: 'supabase_not_configured' });
  }

  const body = JSON.parse(raw || '{}');
  const events = parseMessengerWebhook(body);

  let pending: { conversationId: string; messageId: string }[] = [];
  if (events.length) {
    const res = await processMessengerEvents(db, events);
    pending = res.pending;
  }

  // Batching: wait out the burst window, then run ONE merged turn per conversation
  // whose triggering message is still the newest inbound (a newer message's own
  // webhook handles the burst instead). Awaited inline so it completes in-function.
  if (pending.length) await runMessageBatchDebounce(db, pending);

  return NextResponse.json({ ok: true, messenger: events.length });
}
