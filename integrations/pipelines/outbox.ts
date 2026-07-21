/**
 * Outbox delivery — the ONLY path that calls the Meta send API for DMs.
 *
 * Truthful delivery semantics (EH-010/011/017):
 *   * every outbox row is claimed with a conditional UPDATE (status predicate)
 *     so two workers can never double-send one row;
 *   * a DEFINITE provider error → bounded retry (transient) or failed
 *     (permanent), and the linked message row shows the real state;
 *   * an AMBIGUOUS outcome (timeout after the request may have reached Meta)
 *     → status 'uncertain'; it is NEVER retried automatically (that is how
 *     duplicates happen) — the inbox shows it truthfully with a manual retry;
 *   * AI-authored sends re-check ai_enabled at delivery time, so Take Over
 *     wins races against in-flight replies.
 */
import { sql, type Kysely, type Selectable } from 'kysely';
import type { DB, OutboxMessages } from '../db/types';
import { sendDmText, sendDmImage } from '../providers/messaging';
import { MetaApiError } from '../providers/graph';

export type DeliverOutcome = 'sent' | 'retry' | 'failed' | 'uncertain' | 'skipped' | 'already_done';

export async function deliverOutboxMessage(db: Kysely<DB>, outboxId: string): Promise<DeliverOutcome> {
  // Claim: only a pending row may transition to sending (idempotent worker retry).
  const claimed = await sql<Selectable<OutboxMessages>>`
    update outbox_messages
       set status = 'sending', attempts = attempts + 1
     where id = ${outboxId} and status = 'pending'
    returning *
  `.execute(db);
  const row = claimed.rows[0];
  if (!row) {
    const current = await db.selectFrom('outbox_messages').select('status').where('id', '=', outboxId).executeTakeFirst();
    return current?.status === 'sent' ? 'already_done' : 'skipped';
  }

  // AI messages honor a takeover that happened after composition.
  if (row.sender_type === 'ai' && row.conversation_id) {
    const convo = await db
      .selectFrom('conversations').select('ai_enabled')
      .where('id', '=', row.conversation_id).executeTakeFirst();
    if (convo?.ai_enabled === false) {
      await db.updateTable('outbox_messages')
        .set({ status: 'cancelled', last_error: 'ai_paused_before_delivery' })
        .where('id', '=', outboxId).execute();
      await syncMessageDeliveryStatus(db, row.message_id);
      return 'skipped';
    }
  }

  const channel = row.channel as 'messenger' | 'instagram';
  try {
    const result = row.kind === 'image'
      ? await sendDmImage(channel, row.recipient_id, row.image_url!)
      : await sendDmText(channel, row.recipient_id, row.body ?? '');
    await db.updateTable('outbox_messages')
      .set({ status: 'sent', provider_message_id: result.providerMessageId, sent_at: new Date().toISOString(), last_error: null })
      .where('id', '=', outboxId).execute();
    await syncMessageDeliveryStatus(db, row.message_id);
    return 'sent';
  } catch (e: any) {
    const isMeta = e instanceof MetaApiError;
    const timedOut = isMeta && e.status === 0 && /timed out/i.test(e.message);
    if (timedOut) {
      // The request may or may not have reached Meta — do not guess, do not retry.
      await db.updateTable('outbox_messages')
        .set({ status: 'uncertain', last_error: e.message.slice(0, 500) })
        .where('id', '=', outboxId).execute();
      await syncMessageDeliveryStatus(db, row.message_id);
      return 'uncertain';
    }
    const transient = isMeta ? e.transient : true; // network refusals are retryable
    const exhausted = (row.attempts ?? 0) >= (row.max_attempts ?? 4);
    if (transient && !exhausted) {
      const backoffSeconds = Math.min(300, 10 * 2 ** Math.max(0, (row.attempts ?? 1) - 1));
      await sql`
        update outbox_messages
           set status = 'pending',
               last_error = ${String(e?.message ?? 'send failed').slice(0, 500)},
               next_attempt_at = now() + make_interval(secs => ${backoffSeconds})
         where id = ${outboxId}
      `.execute(db);
      await syncMessageDeliveryStatus(db, row.message_id);
      return 'retry';
    }
    await db.updateTable('outbox_messages')
      .set({ status: transient ? 'dead' : 'failed', last_error: String(e?.message ?? 'send failed').slice(0, 500) })
      .where('id', '=', outboxId).execute();
    await syncMessageDeliveryStatus(db, row.message_id);
    return 'failed';
  }
}

/**
 * Recompute the linked message row's truthful delivery_status + attachments
 * from ALL of its outbox rows (caption + images may land differently).
 */
export async function syncMessageDeliveryStatus(db: Kysely<DB>, messageId: string | null): Promise<void> {
  if (!messageId) return;
  const rows = await db
    .selectFrom('outbox_messages')
    .select(['status', 'kind', 'image_url', 'product_id'])
    .where('message_id', '=', messageId)
    .execute();
  if (!rows.length) return;
  const statuses = new Set(rows.map((r) => r.status));
  let overall: string;
  if ([...statuses].every((s) => s === 'sent')) overall = 'sent';
  else if (statuses.has('uncertain')) overall = 'uncertain';
  else if (statuses.has('pending') || statuses.has('sending')) overall = 'pending';
  else if (statuses.has('sent')) overall = 'partial';
  else if ([...statuses].every((s) => s === 'cancelled')) overall = 'skipped';
  else overall = 'failed';

  // Only images that actually reached Meta appear as message attachments.
  const sentImages = rows
    .filter((r) => r.kind === 'image' && r.status === 'sent' && r.image_url)
    .map((r) => ({ type: 'image', url: r.image_url, product_id: r.product_id ?? null }));
  await db.updateTable('messages')
    .set({
      delivery_status: overall,
      attachments: JSON.stringify(sentImages),
      delivered_at: overall === 'sent' || overall === 'partial' ? new Date().toISOString() : null,
    })
    .where('id', '=', messageId)
    .execute();
}

/**
 * Manual retry for failed/uncertain rows (admin action from the inbox). Resets
 * the row to pending with fresh attempts — an explicit human decision, so the
 * duplicate risk is understood and accepted by the operator.
 */
export async function retryOutboxMessage(db: Kysely<DB>, outboxId: string): Promise<boolean> {
  const res = await sql`
    update outbox_messages
       set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null
     where id = ${outboxId} and status in ('failed', 'uncertain', 'dead', 'cancelled')
  `.execute(db);
  return Number(res.numAffectedRows ?? 0) > 0;
}
