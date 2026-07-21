import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { deliverOutboxMessage, retryOutboxMessage } from '../../integrations/pipelines/outbox';
import { createTestDatabase, seedConversation, type TestDb } from './setup';

/** Stub the Meta Graph send endpoint. */
function stubFetch(handler: (url: string, init?: any) => Response | Promise<Response>) {
  const spy = vi.spyOn(globalThis, 'fetch' as any).mockImplementation(handler as any);
  return spy;
}
const okSend = () => new Response(JSON.stringify({ message_id: 'mid_out_1', recipient_id: 'r1' }), { status: 200, headers: { 'content-type': 'application/json' } });

async function seedOutbox(t: TestDb, over: Partial<Record<string, unknown>> = {}) {
  const { conversationId, externalId } = await seedConversation(t.db);
  const message = await t.db.insertInto('messages').values({
    conversation_id: conversationId, direction: 'outbound', sender_type: 'ai',
    body: 'رد تجريبي', delivery_status: 'pending',
  }).returning('id').executeTakeFirst();
  const row = await t.db.insertInto('outbox_messages').values({
    conversation_id: conversationId, message_id: message!.id,
    channel: 'messenger', recipient_id: externalId,
    kind: 'text', body: 'رد تجريبي',
    idempotency_key: `msg:${message!.id}:text`,
    sender_type: 'ai',
    ...(over as any),
  }).returning('id').executeTakeFirst();
  return { outboxId: row!.id, messageId: message!.id, conversationId };
}

describe('transactional outbox delivery', () => {
  let t: TestDb;
  beforeAll(async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'test-token';
    process.env.META_PAGE_ID = '123';
    t = await createTestDatabase('eh_outbox');
  });
  afterAll(async () => {
    delete process.env.META_PAGE_ACCESS_TOKEN;
    delete process.env.META_PAGE_ID;
    await t.destroy();
  });
  beforeEach(() => vi.restoreAllMocks());

  it('CONCURRENCY: one outbox row can never be sent twice', async () => {
    const { outboxId, messageId } = await seedOutbox(t);
    const spy = stubFetch(async () => okSend());
    const results = await Promise.all(
      Array.from({ length: 6 }, () => deliverOutboxMessage(t.db, outboxId)),
    );
    expect(results.filter((r) => r === 'sent')).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
    const msg = await t.db.selectFrom('messages').select('delivery_status').where('id', '=', messageId).executeTakeFirst();
    expect(msg!.delivery_status).toBe('sent');
  });

  it('a transient provider error retries; the message shows pending (EH-010)', async () => {
    const { outboxId, messageId } = await seedOutbox(t);
    stubFetch(async () => new Response(JSON.stringify({ error: { message: 'try later', code: 2 } }), { status: 500, headers: { 'content-type': 'application/json' } }));
    const outcome = await deliverOutboxMessage(t.db, outboxId);
    expect(outcome).toBe('retry');
    const row = await t.db.selectFrom('outbox_messages').select(['status', 'attempts']).where('id', '=', outboxId).executeTakeFirst();
    expect(row!.status).toBe('pending');
    const msg = await t.db.selectFrom('messages').select('delivery_status').where('id', '=', messageId).executeTakeFirst();
    expect(msg!.delivery_status).toBe('pending');
  });

  it('a permanent provider error is recorded as failed — never as sent (EH-010)', async () => {
    const { outboxId, messageId } = await seedOutbox(t);
    stubFetch(async () => new Response(JSON.stringify({ error: { message: 'invalid recipient', code: 100 } }), { status: 400, headers: { 'content-type': 'application/json' } }));
    const outcome = await deliverOutboxMessage(t.db, outboxId);
    expect(outcome).toBe('failed');
    const msg = await t.db.selectFrom('messages').select(['delivery_status', 'delivered_at']).where('id', '=', messageId).executeTakeFirst();
    expect(msg!.delivery_status).toBe('failed');
    expect(msg!.delivered_at).toBeNull();
  });

  it('an AMBIGUOUS timeout is marked uncertain and NOT auto-retried (EH-011)', async () => {
    const { outboxId } = await seedOutbox(t);
    stubFetch(() => new Promise((_, reject) => {
      const e: any = new Error('aborted');
      e.name = 'AbortError';
      setTimeout(() => reject(e), 5);
    }));
    const outcome = await deliverOutboxMessage(t.db, outboxId, );
    expect(outcome).toBe('uncertain');
    const again = await deliverOutboxMessage(t.db, outboxId);
    expect(again).toBe('skipped'); // stays uncertain until an ADMIN retries
    const manual = await retryOutboxMessage(t.db, outboxId);
    expect(manual).toBe(true);
  });

  it('Take Over wins the race against an in-flight AI reply', async () => {
    const { outboxId, conversationId, messageId } = await seedOutbox(t);
    await t.db.updateTable('conversations').set({ ai_enabled: false }).where('id', '=', conversationId).execute();
    const spy = stubFetch(async () => okSend());
    const outcome = await deliverOutboxMessage(t.db, outboxId);
    expect(outcome).toBe('skipped');
    expect(spy).not.toHaveBeenCalled();
    const msg = await t.db.selectFrom('messages').select('delivery_status').where('id', '=', messageId).executeTakeFirst();
    expect(msg!.delivery_status).toBe('skipped');
  });

  it('caption + image partial success is represented truthfully (EH-017)', async () => {
    const { conversationId } = await seedConversation(t.db);
    const message = await t.db.insertInto('messages').values({
      conversation_id: conversationId, direction: 'outbound', sender_type: 'human',
      body: 'صورة المنتج', delivery_status: 'pending',
    }).returning('id').executeTakeFirst();
    const textRow = await t.db.insertInto('outbox_messages').values({
      conversation_id: conversationId, message_id: message!.id, channel: 'messenger',
      recipient_id: 'r1', kind: 'text', body: 'صورة المنتج',
      idempotency_key: `msg:${message!.id}:text`, sender_type: 'human',
    }).returning('id').executeTakeFirst();
    const imgRow = await t.db.insertInto('outbox_messages').values({
      conversation_id: conversationId, message_id: message!.id, channel: 'messenger',
      recipient_id: 'r1', kind: 'image', image_url: 'https://media.example/p.jpg',
      idempotency_key: `msg:${message!.id}:img:0`, sender_type: 'human', max_attempts: 1,
    }).returning('id').executeTakeFirst();

    stubFetch(async (_url: string, init: any) => {
      const body = JSON.parse(init?.body ?? '{}');
      if (body?.message?.attachment) {
        return new Response(JSON.stringify({ error: { message: 'image rejected', code: 100 } }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return okSend();
    });
    expect(await deliverOutboxMessage(t.db, textRow!.id)).toBe('sent');
    expect(await deliverOutboxMessage(t.db, imgRow!.id)).toBe('failed');
    const msg = await t.db.selectFrom('messages').select(['delivery_status', 'attachments']).where('id', '=', message!.id).executeTakeFirst();
    expect(msg!.delivery_status).toBe('partial');
    // Only images that actually reached Meta appear as attachments.
    expect(msg!.attachments).toEqual([]);
  });
});
