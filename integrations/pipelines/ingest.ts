/**
 * Inbound event ingestion — the worker side of the webhook contract.
 *
 * The webhook route only PERSISTS verified events (inbound_events) and
 * acknowledges after the commit; this handler turns each event into durable
 * conversation state:
 *
 *   messenger/instagram message → upsert customer + one active conversation
 *   (DB-unique, EH-015) + message row (mid-deduped) → debounced customer_turn
 *   job (dedupe key per conversation, run_at pushed forward by newer messages
 *   — the durable replacement for the in-memory sleep debounce).
 *
 * Comment/feed change events schedule a comments_poll for the publication they
 * belong to; comments on content this app did not publish are skipped.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { enqueue } from '../jobs/queue';
import { getDmProfile } from '../providers/messaging';
import { batchWindowMs } from '../flags';

const json = (v: unknown) => JSON.stringify(v ?? null);

export type IngestTopic = 'messenger' | 'instagram' | 'feed_change' | 'ig_comment_change';

export interface DmEvent {
  channel: 'messenger' | 'instagram';
  senderId: string;
  recipientId?: string;
  mid?: string;
  text?: string;
  attachments: { type: string; url?: string }[];
  storyUrl?: string;
  timestamp?: number;
  isEcho?: boolean;
}

/** Parse one raw webhook entry-event into a normalized DM event (or null). */
export function parseDmEvent(topic: 'messenger' | 'instagram', ev: any): DmEvent | null {
  const senderId = ev?.sender?.id;
  if (!senderId || !ev?.message) return null;
  if (ev.message.is_echo) return null; // our own sends echoing back
  const attachments = ((ev.message.attachments ?? []) as any[])
    .map((a) => ({ type: String(a?.type ?? 'file'), url: a?.payload?.url as string | undefined }))
    .filter((a) => !!a.url);
  const storyUrl: string | undefined = ev.message.reply_to?.story?.url;
  if (storyUrl && !attachments.some((a) => a.url === storyUrl)) {
    attachments.push({ type: 'image', url: storyUrl });
  }
  return {
    channel: topic,
    senderId,
    recipientId: ev?.recipient?.id,
    mid: ev.message.mid,
    text: (ev.message.text ?? '').trim(),
    attachments,
    storyUrl,
    timestamp: ev.timestamp,
    isEcho: false,
  };
}

export interface IngestOutcome {
  status: 'processed' | 'skipped';
  conversationId?: string;
  messageId?: string;
  reason?: string;
}

export async function ingestDmEvent(db: Kysely<DB>, ev: DmEvent): Promise<IngestOutcome> {
  // 1. Customer identity (channel-scoped).
  const customer = await db
    .insertInto('customers')
    .values({ channel: ev.channel, external_id: ev.senderId })
    .onConflict((oc) => oc.columns(['channel', 'external_id']).doUpdateSet({ external_id: (eb) => eb.ref('excluded.external_id') }))
    .returning(['id', 'is_blocked', 'first_name', 'display_name'])
    .executeTakeFirst();
  if (!customer) return { status: 'skipped', reason: 'customer_upsert_failed' };
  if (customer.is_blocked) return { status: 'skipped', reason: 'customer_blocked' };
  if (!customer.first_name && !customer.display_name) {
    void fetchProfileBestEffort(db, customer.id, ev.senderId);
  }

  // 2. One active conversation per customer — enforced by the partial unique
  //    index; a concurrent insert loses cleanly and re-selects.
  const terminal = ['resolved', 'completed', 'cancelled', 'spam', 'blocked'] as const;
  let conversationId: string | undefined;
  const existing = await db
    .selectFrom('conversations').select('id')
    .where('customer_id', '=', customer.id)
    .where('status', 'not in', [...terminal])
    .orderBy('last_message_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  conversationId = existing?.id;
  if (!conversationId) {
    try {
      const created = await db
        .insertInto('conversations')
        .values({ customer_id: customer.id, channel: ev.channel, status: 'new', ai_enabled: true })
        .returning('id')
        .executeTakeFirst();
      conversationId = created?.id;
    } catch {
      const raced = await db
        .selectFrom('conversations').select('id')
        .where('customer_id', '=', customer.id)
        .where('status', 'not in', [...terminal])
        .limit(1)
        .executeTakeFirst();
      conversationId = raced?.id;
    }
  }
  if (!conversationId) return { status: 'skipped', reason: 'conversation_unavailable' };

  // 3. Message row (provider-mid dedupe via the unique index on external_id).
  let messageId: string | undefined;
  try {
    const inserted = await db
      .insertInto('messages')
      .values({
        conversation_id: conversationId,
        direction: 'inbound',
        sender_type: 'customer',
        body: ev.text || null,
        attachments: json(ev.attachments),
        external_id: ev.mid ?? null,
      })
      .returning('id')
      .executeTakeFirst();
    messageId = inserted?.id;
  } catch (e: any) {
    if (String(e?.message ?? '').includes('uq_messages_external') || String(e?.code) === '23505') {
      return { status: 'skipped', conversationId, reason: 'duplicate_mid' };
    }
    throw e;
  }

  const now = new Date().toISOString();
  await db
    .updateTable('conversations')
    .set((eb) => ({
      last_message_at: now,
      last_customer_message_at: now,
      last_message_preview: (ev.text || '[صورة]').slice(0, 120),
      unread_count: eb('unread_count', '+', 1),
    }))
    .where('id', '=', conversationId)
    .execute();

  // 4. Durable debounce: one live turn job per conversation; a newer message
  //    pushes the due time forward so the whole burst is answered once.
  await enqueue(db, {
    jobType: 'customer_turn',
    dedupeKey: `turn:${conversationId}`,
    payload: { conversationId, triggerMessageId: messageId },
    runAt: new Date(Date.now() + batchWindowMs()),
    onDuplicate: 'push_run_at',
    maxAttempts: 3,
  });

  return { status: 'processed', conversationId, messageId };
}

async function fetchProfileBestEffort(db: Kysely<DB>, customerId: string, providerUserId: string): Promise<void> {
  try {
    const profile = await getDmProfile(providerUserId);
    if (!profile) return;
    const first = profile.first_name ?? null;
    const last = profile.last_name ?? null;
    const display = [first, last].filter(Boolean).join(' ') || profile.name || null;
    if (first || display) {
      await db
        .updateTable('customers')
        .set({ first_name: first, last_name: last, display_name: display, profile_pic_url: profile.profile_pic ?? null })
        .where('id', '=', customerId)
        .execute();
    }
  } catch { /* best-effort */ }
}

/**
 * Process one persisted inbound event (worker job handler).
 */
export async function processInboundEvent(db: Kysely<DB>, eventId: string): Promise<IngestOutcome> {
  const event = await db
    .selectFrom('inbound_events')
    .selectAll()
    .where('id', '=', eventId)
    .executeTakeFirst();
  if (!event) return { status: 'skipped', reason: 'event_missing' };
  if (event.status === 'processed') return { status: 'skipped', reason: 'already_processed' };

  try {
    let outcome: IngestOutcome = { status: 'skipped', reason: 'unhandled_topic' };
    const payload: any = event.payload;
    if (event.topic === 'messenger' || event.topic === 'instagram') {
      const dm = parseDmEvent(event.topic, payload);
      outcome = dm ? await ingestDmEvent(db, dm) : { status: 'skipped', reason: 'not_a_message' };
    } else if (event.topic === 'feed_change' || event.topic === 'ig_comment_change') {
      // Comment activity: poll comments for our own published content soon.
      await enqueue(db, {
        jobType: 'comments_poll',
        dedupeKey: 'comments_poll',
        runAt: new Date(Date.now() + 10_000),
        onDuplicate: 'ignore',
      });
      outcome = { status: 'processed' };
    }
    await db
      .updateTable('inbound_events')
      .set({ status: outcome.status === 'processed' ? 'processed' : 'skipped', processed_at: new Date().toISOString(), last_error: outcome.reason ?? null })
      .where('id', '=', eventId)
      .execute();
    return outcome;
  } catch (e: any) {
    await db
      .updateTable('inbound_events')
      .set((eb) => ({ status: 'failed', attempts: eb('attempts', '+', 1), last_error: String(e?.message ?? e).slice(0, 1000) }))
      .where('id', '=', eventId)
      .execute();
    throw e;
  }
}
