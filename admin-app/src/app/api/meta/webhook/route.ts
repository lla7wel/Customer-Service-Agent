import { NextRequest, NextResponse } from 'next/server';
import { verifySubscription, verifyWebhookSignature } from '@integrations/meta';
import { metaStatus } from '@integrations/status';
import { getDb } from '@integrations/db/client';
import { enqueue } from '@integrations/jobs/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Meta webhook — persist-then-acknowledge, nothing else (EH-016).
 *
 * POST verifies the X-Hub-Signature-256, persists every event into
 * inbound_events (provider-key deduped) atomically WITH its ingest job, and
 * only then returns 200. All processing (customer upsert, batching, the AI
 * turn, delivery) happens in the worker. If the database is unavailable the
 * route answers 503 so Meta retries — an acknowledged event is never lost.
 *
 * GET is the subscription handshake (echoes hub.challenge).
 */
export async function GET(req: NextRequest) {
  if (!metaStatus().configured) {
    return NextResponse.json({ error: 'integration_not_configured', missing: metaStatus().missing }, { status: 503 });
  }
  const { ok, challenge } = verifySubscription(req.nextUrl.searchParams);
  if (ok && challenge !== undefined) {
    return new NextResponse(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

interface RawEvent {
  topic: 'messenger' | 'instagram' | 'feed_change' | 'ig_comment_change';
  providerEventKey: string | null;
  payload: unknown;
}

/** Flatten a webhook body (page or instagram object) into normalized events. */
function extractEvents(body: any): RawEvent[] {
  const out: RawEvent[] = [];
  const objectType = String(body?.object ?? '');
  for (const entry of body?.entry ?? []) {
    for (const ev of entry?.messaging ?? []) {
      out.push({
        topic: objectType === 'instagram' ? 'instagram' : 'messenger',
        providerEventKey: ev?.message?.mid ?? null,
        payload: ev,
      });
    }
    for (const change of entry?.changes ?? []) {
      const field = String(change?.field ?? '');
      if (field === 'feed' || field === 'comments' || field === 'mention') {
        out.push({
          topic: objectType === 'instagram' ? 'ig_comment_change' : 'feed_change',
          providerEventKey: change?.value?.comment_id ?? change?.value?.post_id ?? null,
          payload: change,
        });
      }
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  if (!metaStatus().configured) {
    return NextResponse.json({ error: 'integration_not_configured', missing: metaStatus().missing }, { status: 503 });
  }
  const raw = await req.text();
  const valid = await verifyWebhookSignature(raw, req.headers.get('x-hub-signature-256'));
  if (!valid) return new NextResponse('Invalid signature', { status: 401 });

  const db = getDb();
  if (!db) {
    // No durable storage → tell Meta to retry. Never acknowledge what we
    // cannot keep.
    return NextResponse.json({ error: 'storage_unavailable' }, { status: 503 });
  }

  let body: any;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return NextResponse.json({ error: 'malformed_json' }, { status: 400 });
  }
  const events = extractEvents(body);
  if (!events.length) return NextResponse.json({ ok: true, stored: 0 });

  try {
    let stored = 0;
    await db.transaction().execute(async (trx) => {
      for (const ev of events) {
        const inserted = await trx
          .insertInto('inbound_events')
          .values({
            provider: 'meta',
            topic: ev.topic,
            provider_event_key: ev.providerEventKey,
            payload: JSON.stringify(ev.payload),
          })
          .onConflict((oc) => oc
            .columns(['provider', 'topic', 'provider_event_key'])
            .where('provider_event_key', 'is not', null)
            .doNothing())
          .returning('id')
          .executeTakeFirst();
        if (!inserted) continue; // provider redelivery of a stored event
        stored++;
        await enqueue(trx, {
          jobType: 'ingest_event',
          payload: { eventId: inserted.id },
          priority: 40,
          maxAttempts: 5,
        });
      }
    });
    return NextResponse.json({ ok: true, stored });
  } catch {
    // Database failure mid-persist → retryable, nothing acknowledged.
    return NextResponse.json({ error: 'storage_failed' }, { status: 503 });
  }
}
