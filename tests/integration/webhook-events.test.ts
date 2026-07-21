import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { processInboundEvent } from '../../integrations/pipelines/ingest';
import { enqueue } from '../../integrations/jobs/queue';
import { createTestDatabase, type TestDb } from './setup';

/** Mirrors what the webhook route persists inside its transaction. */
async function persistEvent(t: TestDb, topic: string, key: string | null, payload: unknown) {
  return t.db.transaction().execute(async (trx) => {
    const inserted = await trx.insertInto('inbound_events').values({
      provider: 'meta', topic, provider_event_key: key, payload: JSON.stringify(payload),
    })
      .onConflict((oc) => oc.columns(['provider', 'topic', 'provider_event_key'])
        .where('provider_event_key', 'is not', null).doNothing())
      .returning('id').executeTakeFirst();
    if (!inserted) return null;
    await enqueue(trx, { jobType: 'ingest_event', payload: { eventId: inserted.id }, priority: 40 });
    return inserted.id;
  });
}

describe('webhook event durability and dedupe (EH-016)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDatabase('eh_webhook'); });
  afterAll(async () => { await t.destroy(); });

  it('persists the event AND its ingest job atomically', async () => {
    const id = await persistEvent(t, 'messenger', 'mid_w1', {
      sender: { id: 'psid_w1' }, message: { mid: 'mid_w1', text: 'سلام' },
    });
    expect(id).toBeTruthy();
    const job = await t.db.selectFrom('jobs').select(['job_type', 'payload'])
      .where('job_type', '=', 'ingest_event').orderBy('created_at', 'desc').executeTakeFirst();
    expect((job!.payload as any).eventId).toBe(id);
  });

  it('a Meta REDELIVERY of the same event is stored once and re-queues nothing', async () => {
    const first = await persistEvent(t, 'messenger', 'mid_dupe', {
      sender: { id: 'psid_w2' }, message: { mid: 'mid_dupe', text: 'مرحبا' },
    });
    const second = await persistEvent(t, 'messenger', 'mid_dupe', {
      sender: { id: 'psid_w2' }, message: { mid: 'mid_dupe', text: 'مرحبا' },
    });
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    const rows = await t.db.selectFrom('inbound_events').select('id')
      .where('provider_event_key', '=', 'mid_dupe').execute();
    expect(rows).toHaveLength(1);
    const jobs = await t.db.selectFrom('jobs').select('id')
      .where('job_type', '=', 'ingest_event')
      .where((eb) => eb(eb.ref('payload', '->>').key('eventId') as any, '=', first!))
      .execute();
    expect(jobs).toHaveLength(1);
  });

  it('processing marks the event processed and creates the conversation exactly once', async () => {
    const id = await persistEvent(t, 'messenger', 'mid_proc', {
      sender: { id: 'psid_w3' }, message: { mid: 'mid_proc', text: 'عندكم مفارش؟' },
    });
    const out = await processInboundEvent(t.db, id!);
    expect(out.status).toBe('processed');
    const ev = await t.db.selectFrom('inbound_events').select(['status', 'processed_at']).where('id', '=', id!).executeTakeFirst();
    expect(ev!.status).toBe('processed');
    expect(ev!.processed_at).not.toBeNull();

    // Re-processing the same stored event is a no-op (worker retry safety).
    const again = await processInboundEvent(t.db, id!);
    expect(again.status).toBe('skipped');
    const msgs = await t.db.selectFrom('messages').select('id').where('external_id', '=', 'mid_proc').execute();
    expect(msgs).toHaveLength(1);
  });

  it('an Instagram DM event creates an INSTAGRAM conversation, separate from Messenger', async () => {
    const igId = await persistEvent(t, 'instagram', 'mid_ig1', {
      sender: { id: 'igsid_1' }, message: { mid: 'mid_ig1', text: 'هلا' },
    });
    await processInboundEvent(t.db, igId!);
    const convo = await t.db.selectFrom('conversations')
      .innerJoin('customers', 'customers.id', 'conversations.customer_id')
      .select(['conversations.channel', 'customers.channel as customer_channel'])
      .where('customers.external_id', '=', 'igsid_1').executeTakeFirst();
    expect(convo!.channel).toBe('instagram');
    expect(convo!.customer_channel).toBe('instagram');
  });

  it('a comment/feed change schedules a comments poll instead of a customer turn', async () => {
    const id = await persistEvent(t, 'feed_change', 'comment_123', {
      field: 'feed', value: { item: 'comment', comment_id: 'comment_123', post_id: 'post_1' },
    });
    const out = await processInboundEvent(t.db, id!);
    expect(out.status).toBe('processed');
    const poll = await t.db.selectFrom('jobs').select('job_type')
      .where('dedupe_key', '=', 'comments_poll').executeTakeFirst();
    expect(poll!.job_type).toBe('comments_poll');
  });

  it('an unparseable event is marked skipped, never silently lost', async () => {
    const id = await persistEvent(t, 'messenger', 'mid_bad', { sender: { id: 'psid_bad' } /* no message */ });
    const out = await processInboundEvent(t.db, id!);
    expect(out.status).toBe('skipped');
    const ev = await t.db.selectFrom('inbound_events').select(['status', 'last_error']).where('id', '=', id!).executeTakeFirst();
    expect(ev!.status).toBe('skipped');
    expect(ev!.last_error).toBe('not_a_message');
  });
});
