import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';

/** The AI layer is mocked: these tests verify PIPELINE behavior, not Gemini. */
const composeMock = vi.fn();
vi.mock('../../integrations/gemini', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isGeminiConfigured: () => true,
}));
vi.mock('../../integrations/pipelines/compose-reply', () => ({
  composeCustomerReply: (...args: unknown[]) => composeMock(...args),
}));

import { runCustomerTurn } from '../../integrations/pipelines/turn';
import { ingestDmEvent } from '../../integrations/pipelines/ingest';
import { createTestDatabase, seedProduct, seedConversation, type TestDb } from './setup';

const reply = (text: string, over: Record<string, unknown> = {}) => ({
  text, model: 'test-model', rounds: 1, toolCalls: [], ok: true,
  promptTraceId: 'trace', promptContributors: [],
  actions: { imageProductIds: [], humanAttention: { requested: false, reason: null }, orderHandoff: { requested: false } },
  ...over,
});

async function inbound(t: TestDb, conversationId: string, body: string, attachments: unknown[] = []) {
  const row = await t.db.insertInto('messages').values({
    conversation_id: conversationId, direction: 'inbound', sender_type: 'customer',
    body, attachments: JSON.stringify(attachments),
  }).returning('id').executeTakeFirst();
  await t.db.updateTable('conversations')
    .set({ last_message_at: new Date().toISOString() }).where('id', '=', conversationId).execute();
  return row!.id;
}

const outboundTexts = async (t: TestDb, conversationId: string) =>
  (await t.db.selectFrom('outbox_messages').select(['body', 'kind', 'image_url'])
    .where('conversation_id', '=', conversationId).orderBy('created_at', 'asc').execute());

describe('customer turn pipeline', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDatabase('eh_turn'); });
  afterAll(async () => { await t.destroy(); });
  beforeEach(() => {
    composeMock.mockReset();
    composeMock.mockResolvedValue(reply('أهلاً بيك 🤍'));
  });

  it('ORDER INTENT: sends the ONE official handoff, flags attention, never confirms an order', async () => {
    const { conversationId } = await seedConversation(t.db);
    await inbound(t, conversationId, 'نبي نطلب هذا المنتج');
    const r = await runCustomerTurn(t.db, conversationId);
    expect(r.outcome).toBe('handoff');

    const sends = await outboundTexts(t, conversationId);
    expect(sends).toHaveLength(1);
    expect(sends[0].body).toContain('تمام، الفريق بيكمل معاك في الطلب');
    expect(sends[0].body).toContain('https://wh.ms/218923322008');
    expect(sends[0].body).toContain('0924565511');
    // Never an order confirmation, never a request for order details.
    expect(sends[0].body).not.toMatch(/تم الطلب|تم تأكيد|عنوانك|رقم الطلب/);

    const convo = await t.db.selectFrom('conversations')
      .select(['human_attention', 'human_attention_reason', 'handoff_sent_at', 'ai_enabled'])
      .where('id', '=', conversationId).executeTakeFirst();
    expect(convo!.human_attention).toBe(true);
    expect(convo!.human_attention_reason).toBe('order_intent');
    expect(convo!.handoff_sent_at).not.toBeNull();
    // The AI stays ON — the brief requires normal follow-ups to keep working.
    expect(convo!.ai_enabled).toBe(true);
  });

  it('NO HANDOFF SPAM: a repeated order message does not re-send the handoff', async () => {
    const { conversationId } = await seedConversation(t.db);
    await inbound(t, conversationId, 'نبي نطلب');
    await runCustomerTurn(t.db, conversationId);
    const afterFirst = (await outboundTexts(t, conversationId)).length;

    await inbound(t, conversationId, 'نبي نطلب برشة');
    const second = await runCustomerTurn(t.db, conversationId);
    expect(second.outcome).toBe('skipped');
    expect(second.reason).toBe('handoff_recently_sent');
    expect((await outboundTexts(t, conversationId)).length).toBe(afterFirst);
  });

  it('after a handoff the AI STILL answers ordinary product questions', async () => {
    const { conversationId } = await seedConversation(t.db);
    await inbound(t, conversationId, 'نبي نطلب');
    await runCustomerTurn(t.db, conversationId);
    composeMock.mockResolvedValue(reply('المقاس متوفر 160×220 🤍'));

    await inbound(t, conversationId, 'بكم المقاس الكبير؟');
    const r = await runCustomerTurn(t.db, conversationId);
    expect(r.outcome).toBe('replied');
    const sends = await outboundTexts(t, conversationId);
    expect(sends[sends.length - 1].body).toContain('المقاس متوفر');
  });

  it('COMPLAINT: flags human attention and acknowledges, without the order handoff', async () => {
    const { conversationId } = await seedConversation(t.db);
    composeMock.mockResolvedValue(reply('آسفين على الإزعاج، الفريق بيتواصل معاك 🤍'));
    await inbound(t, conversationId, 'عندي شكوى، المنتج وصل مكسور');
    const r = await runCustomerTurn(t.db, conversationId);
    expect(r.outcome).toBe('replied');

    const convo = await t.db.selectFrom('conversations')
      .select(['human_attention', 'human_attention_reason', 'ai_enabled'])
      .where('id', '=', conversationId).executeTakeFirst();
    expect(convo!.human_attention).toBe(true);
    expect(convo!.human_attention_reason).toBe('complaint');
    expect(convo!.ai_enabled).toBe(true);
    const sends = await outboundTexts(t, conversationId);
    expect(sends.every((s) => !s.body?.includes('wh.ms'))).toBe(true);
  });

  it('TAKE OVER: an admin pause stops the AI from replying at all', async () => {
    const { conversationId } = await seedConversation(t.db);
    await t.db.updateTable('conversations').set({ ai_enabled: false, status: 'human_active' })
      .where('id', '=', conversationId).execute();
    await inbound(t, conversationId, 'بكم هذا؟');
    const r = await runCustomerTurn(t.db, conversationId);
    expect(r.outcome).toBe('skipped');
    expect(r.reason).toBe('admin_takeover');
    expect(await outboundTexts(t, conversationId)).toHaveLength(0);
  });

  it('RESUME AI: after resuming, the AI answers with the FULL prior history (no amnesia)', async () => {
    const { conversationId } = await seedConversation(t.db);
    await inbound(t, conversationId, 'سلام، عندكم مفارش؟');
    await runCustomerTurn(t.db, conversationId);
    await t.db.updateTable('conversations').set({ ai_enabled: false }).where('id', '=', conversationId).execute();
    await inbound(t, conversationId, 'وبكم؟');
    await runCustomerTurn(t.db, conversationId);
    // Admin resumes.
    await t.db.updateTable('conversations').set({ ai_enabled: true, status: 'ai_handling' })
      .where('id', '=', conversationId).execute();

    composeMock.mockReset();
    composeMock.mockResolvedValue(reply('سعره 250 د.ل 🤍'));
    await inbound(t, conversationId, 'وبكم؟');
    const r = await runCustomerTurn(t.db, conversationId);
    expect(r.outcome).toBe('replied');
    const args = composeMock.mock.calls.at(-1)![1] as { history: { role: string; text: string }[] };
    expect(args.history.length).toBeGreaterThanOrEqual(2);
    expect(args.history.some((h) => h.text.includes('عندكم مفارش'))).toBe(true);
  });

  it('ONE REPLY PER BURST: concurrent turns for one conversation produce exactly one reply', async () => {
    const { conversationId } = await seedConversation(t.db);
    await inbound(t, conversationId, 'سلام');
    await inbound(t, conversationId, 'عندكم مناشف؟');
    const results = await Promise.all([
      runCustomerTurn(t.db, conversationId),
      runCustomerTurn(t.db, conversationId),
      runCustomerTurn(t.db, conversationId),
    ]);
    expect(results.filter((r) => r.outcome === 'replied')).toHaveLength(1);
    const outbound = await t.db.selectFrom('messages').select('id')
      .where('conversation_id', '=', conversationId).where('direction', '=', 'outbound').execute();
    expect(outbound).toHaveLength(1);
  });

  it('SUPERSEDE: a newer inbound mid-turn abandons the stale reply and re-queues the turn', async () => {
    const { conversationId } = await seedConversation(t.db);
    const first = await inbound(t, conversationId, 'شوف هذا');
    // While composing, a newer message arrives.
    composeMock.mockImplementation(async () => {
      await inbound(t, conversationId, 'وبكم سعره؟');
      return reply('رد قديم');
    });
    const r = await runCustomerTurn(t.db, conversationId);
    expect(r.outcome).toBe('superseded');
    expect(await outboundTexts(t, conversationId)).toHaveLength(0);
    const job = await t.db.selectFrom('jobs').select('id')
      .where('dedupe_key', '=', `turn:${conversationId}`).where('status', '=', 'pending').executeTakeFirst();
    expect(job).toBeDefined();
    expect(first).toBeTruthy();
  });

  it('WHOLE BURST: every unanswered message enters the turn (no silent 20-cap, EH-002)', async () => {
    const { conversationId } = await seedConversation(t.db);
    for (let i = 0; i < 25; i++) await inbound(t, conversationId, `رسالة رقم ${i}`);
    await runCustomerTurn(t.db, conversationId);
    const args = composeMock.mock.calls.at(-1)![1] as { message: string };
    expect(args.message).toContain('رسالة رقم 0');
    expect(args.message).toContain('رسالة رقم 24');
  });

  it('IMAGE CAP: a model asking for many photos sends at most three, all real catalog URLs', async () => {
    process.env.PUBLIC_MEDIA_BASE_URL = 'https://media.test';
    const { conversationId } = await seedConversation(t.db);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await seedProduct(t.db, { product_code: `IMGCAP${i}`, english_name: `Cap Product ${i}` });
      await t.db.insertInto('product_images').values({
        product_id: id, public_url: `https://media.test/p/${i}.jpg`, position: 0, is_primary: true,
      }).execute();
      ids.push(id);
    }
    composeMock.mockResolvedValue(reply('هذي الصور 🤍', {
      actions: { imageProductIds: ids, humanAttention: { requested: false, reason: null }, orderHandoff: { requested: false } },
    }));
    await inbound(t, conversationId, 'ممكن نشوف صور؟');
    await runCustomerTurn(t.db, conversationId);

    const images = (await outboundTexts(t, conversationId)).filter((s) => s.kind === 'image');
    expect(images.length).toBeGreaterThan(0);
    expect(images.length).toBeLessThanOrEqual(3);
    expect(images.every((i) => i.image_url!.startsWith('https://'))).toBe(true);
  });

  it('MODEL-DETECTED ORDER INTENT also triggers exactly one official handoff', async () => {
    const { conversationId } = await seedConversation(t.db);
    composeMock.mockResolvedValue(reply('تمام 🤍', {
      actions: { imageProductIds: [], humanAttention: { requested: false, reason: null }, orderHandoff: { requested: true } },
    }));
    await inbound(t, conversationId, 'ممكن تجهزوه لي؟');
    await runCustomerTurn(t.db, conversationId);
    const sends = await outboundTexts(t, conversationId);
    const handoffs = sends.filter((s) => s.body?.includes('wh.ms'));
    expect(handoffs).toHaveLength(1);
    const convo = await t.db.selectFrom('conversations').select(['human_attention', 'handoff_sent_at'])
      .where('id', '=', conversationId).executeTakeFirst();
    expect(convo!.human_attention).toBe(true);
    expect(convo!.handoff_sent_at).not.toBeNull();
  });

  it('INSTAGRAM: an IG conversation queues IG-channel delivery', async () => {
    const { conversationId } = await seedConversation(t.db, 'instagram');
    await inbound(t, conversationId, 'مرحبا');
    await runCustomerTurn(t.db, conversationId);
    const row = await t.db.selectFrom('outbox_messages').select('channel')
      .where('conversation_id', '=', conversationId).executeTakeFirst();
    expect(row!.channel).toBe('instagram');
  });

  it('end-to-end: webhook ingest → turn → durable outbox row', async () => {
    const r = await ingestDmEvent(t.db, {
      channel: 'messenger', senderId: 'psid_e2e', mid: 'mid_e2e_1', text: 'عندكم مخدات؟', attachments: [],
    });
    expect(r.status).toBe('processed');
    composeMock.mockResolvedValue(reply('عندنا مخدات قطن 🤍'));
    const turn = await runCustomerTurn(t.db, r.conversationId!);
    expect(turn.outcome).toBe('replied');
    const outbox = await t.db.selectFrom('outbox_messages').select(['status', 'body'])
      .where('conversation_id', '=', r.conversationId!).executeTakeFirst();
    expect(outbox!.status).toBe('pending');
    expect(outbox!.body).toContain('مخدات');
  });
});
