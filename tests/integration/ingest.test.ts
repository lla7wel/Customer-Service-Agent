import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { ingestDmEvent, parseDmEvent } from '../../integrations/pipelines/ingest';
import { createTestDatabase, type TestDb } from './setup';

const dm = (senderId: string, mid: string, text = 'سلام') => ({
  channel: 'messenger' as const, senderId, mid, text, attachments: [],
});

describe('inbound event ingestion', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDatabase('eh_ingest'); });
  afterAll(async () => { await t.destroy(); });

  it('parses DM events and drops echoes of our own sends', () => {
    expect(parseDmEvent('messenger', { sender: { id: 'u1' }, message: { mid: 'm1', text: 'hi' } })).not.toBeNull();
    expect(parseDmEvent('messenger', { sender: { id: 'u1' }, message: { mid: 'm1', text: 'hi', is_echo: true } })).toBeNull();
    expect(parseDmEvent('messenger', { sender: { id: 'u1' } })).toBeNull();
  });

  it('treats a story reply as an image attachment', () => {
    const ev = parseDmEvent('instagram', {
      sender: { id: 'u2' },
      message: { mid: 'm2', text: 'بكم؟', reply_to: { story: { url: 'https://cdn.example/story.jpg' } } },
    });
    expect(ev!.attachments).toEqual([{ type: 'image', url: 'https://cdn.example/story.jpg' }]);
  });

  it('provider redelivery of the same mid is a no-op', async () => {
    const first = await ingestDmEvent(t.db, dm('psid_dup', 'mid_dup_1'));
    expect(first.status).toBe('processed');
    const second = await ingestDmEvent(t.db, dm('psid_dup', 'mid_dup_1'));
    expect(second.status).toBe('skipped');
    expect(second.reason).toBe('duplicate_mid');
    const msgs = await t.db.selectFrom('messages').select('id')
      .where('conversation_id', '=', first.conversationId!).execute();
    expect(msgs).toHaveLength(1);
  });

  it('concurrent first messages create exactly ONE active conversation (EH-015)', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => ingestDmEvent(t.db, dm('psid_race', `mid_race_${i}`))),
    );
    const convoIds = new Set(results.map((r) => r.conversationId).filter(Boolean));
    expect(convoIds.size).toBe(1);
    const convos = await t.db.selectFrom('conversations')
      .innerJoin('customers', 'customers.id', 'conversations.customer_id')
      .select('conversations.id')
      .where('customers.external_id', '=', 'psid_race')
      .execute();
    expect(convos).toHaveLength(1);
  });

  it('a message burst keeps ONE debounced turn job and pushes it forward', async () => {
    await ingestDmEvent(t.db, dm('psid_burst', 'mid_b1'));
    await ingestDmEvent(t.db, dm('psid_burst', 'mid_b2'));
    await ingestDmEvent(t.db, dm('psid_burst', 'mid_b3'));
    const convo = await t.db.selectFrom('conversations')
      .innerJoin('customers', 'customers.id', 'conversations.customer_id')
      .select('conversations.id')
      .where('customers.external_id', '=', 'psid_burst')
      .executeTakeFirst();
    const jobs = await t.db.selectFrom('jobs').select(['id'])
      .where('dedupe_key', '=', `turn:${convo!.id}`)
      .where('status', '=', 'pending')
      .execute();
    expect(jobs).toHaveLength(1);
  });

  it('increments unread and updates the inbox preview', async () => {
    const r = await ingestDmEvent(t.db, dm('psid_unread', 'mid_u1', 'وين الفرع؟'));
    const convo = await t.db.selectFrom('conversations')
      .select(['unread_count', 'last_message_preview'])
      .where('id', '=', r.conversationId!)
      .executeTakeFirst();
    expect(convo!.unread_count).toBe(1);
    expect(convo!.last_message_preview).toBe('وين الفرع؟');
  });

  it('blocked customers are ignored', async () => {
    await t.db.insertInto('customers')
      .values({ channel: 'messenger', external_id: 'psid_blocked', is_blocked: true })
      .execute();
    const r = await ingestDmEvent(t.db, dm('psid_blocked', 'mid_bl1'));
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('customer_blocked');
  });
});
