import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { pollAndProcessComments } from '../../integrations/pipelines/comments';
import { createTestDatabase, seedProduct, type TestDb } from './setup';

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function seedPublishedContent(t: TestDb, opts: {
  providerPostId: string; products: { price: number | null }[]; automation?: boolean; platform?: 'facebook' | 'instagram';
}) {
  const item = await t.db.insertInto('content_items').values({
    title: 'Published item', content_type: 'post', platforms: [opts.platform ?? 'facebook'],
    purpose: 'general', output_mode: 'original', status: 'published',
    comment_automation: opts.automation !== false,
  }).returning('id').executeTakeFirst();
  for (const p of opts.products) {
    const productId = await seedProduct(t.db, {
      base_price: p.price, active_price: p.price, status: p.price == null ? 'draft' : 'active',
    });
    await t.db.insertInto('content_products').values({ content_item_id: item!.id, product_id: productId }).execute();
  }
  const pub = await t.db.insertInto('content_publications').values({
    content_item_id: item!.id, platform: opts.platform ?? 'facebook', format: 'feed',
    status: 'published', idempotency_key: `pub:${item!.id}:${opts.platform ?? 'facebook'}`,
    provider_post_id: opts.providerPostId, published_at: new Date(Date.now() - 3600_000).toISOString(),
  }).returning('id').executeTakeFirst();
  return { itemId: item!.id, publicationId: pub!.id };
}

describe('comment automation (app-published content only)', () => {
  let t: TestDb;
  beforeAll(async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'test-token';
    process.env.META_PAGE_ID = 'page123';
    process.env.META_IG_USER_ID = 'ig123';
    t = await createTestDatabase('eh_comments');
  });
  afterAll(async () => {
    delete process.env.META_PAGE_ACCESS_TOKEN;
    delete process.env.META_PAGE_ID;
    delete process.env.META_IG_USER_ID;
    await t.destroy();
  });
  beforeEach(() => vi.restoreAllMocks());

  it('ONLY polls posts this app published — an old/manual post is never touched', async () => {
    await seedPublishedContent(t, { providerPostId: 'post_app_1', products: [{ price: 189 }] });
    const requested: string[] = [];
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
      requested.push(String(url));
      if (String(url).includes('/comments')) return jsonRes({ data: [] });
      return jsonRes({ id: 'x' });
    });
    await pollAndProcessComments(t.db);
    // Every comment fetch targets our own publication's provider post id.
    const commentFetches = requested.filter((u) => u.includes('/comments'));
    expect(commentFetches.length).toBeGreaterThan(0);
    expect(commentFetches.every((u) => u.includes('post_app_1'))).toBe(true);
  });

  it('EXACT PRICE reply for one product with a verified active price', async () => {
    const { publicationId } = await seedPublishedContent(t, { providerPostId: 'post_price', products: [{ price: 189 }] });
    const replies: string[] = [];
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes('post_price/comments')) {
        return jsonRes({ data: [{ id: 'c_price_1', message: 'بكم؟', from: { id: 'u1', name: 'Ali' }, created_time: new Date().toISOString() }] });
      }
      if (u.includes('/replies')) { replies.push(JSON.parse(init.body).message); return jsonRes({ id: 'r1' }); }
      return jsonRes({ data: [] });
    });
    const res = await pollAndProcessComments(t.db);
    expect(res.replied).toBe(1);
    expect(replies[0]).toContain('189');
    expect(replies[0]).toContain('رسالة خاصة');
    const stored = await t.db.selectFrom('content_comments')
      .select(['decision', 'reply_status']).where('publication_id', '=', publicationId).executeTakeFirst();
    expect(stored).toMatchObject({ decision: 'reply_price', reply_status: 'sent' });
  });

  it('MULTI-PRODUCT post → DM invitation only, never a guessed price', async () => {
    await seedPublishedContent(t, { providerPostId: 'post_multi', products: [{ price: 100 }, { price: 220 }] });
    const replies: string[] = [];
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes('post_multi/comments')) {
        return jsonRes({ data: [{ id: 'c_multi_1', message: 'بكم؟', from: { id: 'u2', name: 'Sara' }, created_time: new Date().toISOString() }] });
      }
      if (u.includes('/replies')) { replies.push(JSON.parse(init.body).message); return jsonRes({ id: 'r2' }); }
      return jsonRes({ data: [] });
    });
    await pollAndProcessComments(t.db);
    const stored = await t.db.selectFrom('content_comments').select(['decision', 'reply_text'])
      .where('provider_comment_id', '=', 'c_multi_1').executeTakeFirst();
    expect(stored!.decision).toBe('reply_dm');
    expect(stored!.reply_text).not.toMatch(/\d{2,}/); // no numbers = no invented price
  });

  it('NEVER loops: a comment already answered is not answered again', async () => {
    await seedPublishedContent(t, { providerPostId: 'post_loop', products: [{ price: 75 }] });
    let replyCalls = 0;
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('post_loop/comments')) {
        return jsonRes({ data: [{ id: 'c_loop_1', message: 'السعر؟', from: { id: 'u3' }, created_time: new Date().toISOString() }] });
      }
      if (u.includes('/replies')) { replyCalls++; return jsonRes({ id: 'r3' }); }
      return jsonRes({ data: [] });
    });
    await pollAndProcessComments(t.db);
    await pollAndProcessComments(t.db);
    await pollAndProcessComments(t.db);
    expect(replyCalls).toBe(1);
  });

  it('our own comments are recorded and skipped', async () => {
    await seedPublishedContent(t, { providerPostId: 'post_self', products: [{ price: 55 }] });
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('post_self/comments')) {
        return jsonRes({ data: [{ id: 'c_self_1', message: 'شكراً', from: { id: 'page123', name: 'EH' }, created_time: new Date().toISOString() }] });
      }
      if (u.includes('/replies')) throw new Error('must not reply to our own comment');
      return jsonRes({ data: [] });
    });
    await pollAndProcessComments(t.db);
    const stored = await t.db.selectFrom('content_comments').select(['decision', 'reply_status'])
      .where('provider_comment_id', '=', 'c_self_1').executeTakeFirst();
    expect(stored).toMatchObject({ decision: 'skip_own', reply_status: 'skipped' });
  });

  it('automation disabled for one item stops replies for that item only', async () => {
    await seedPublishedContent(t, { providerPostId: 'post_off', products: [{ price: 120 }], automation: false });
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('post_off/comments')) {
        return jsonRes({ data: [{ id: 'c_off_1', message: 'بكم؟', from: { id: 'u4' }, created_time: new Date().toISOString() }] });
      }
      if (u.includes('/replies')) throw new Error('automation is disabled for this item');
      return jsonRes({ data: [] });
    });
    await pollAndProcessComments(t.db);
    const stored = await t.db.selectFrom('content_comments').select('decision')
      .where('provider_comment_id', '=', 'c_off_1').executeTakeFirst();
    expect(stored!.decision).toBe('skip_disabled');
  });

  it('a failed reply is stored truthfully as failed', async () => {
    await seedPublishedContent(t, { providerPostId: 'post_fail', products: [{ price: 300 }] });
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('post_fail/comments')) {
        return jsonRes({ data: [{ id: 'c_fail_1', message: 'بكم؟', from: { id: 'u5' }, created_time: new Date().toISOString() }] });
      }
      if (u.includes('/replies')) return jsonRes({ error: { message: 'comment deleted', code: 100 } }, 400);
      return jsonRes({ data: [] });
    });
    const res = await pollAndProcessComments(t.db);
    expect(res.failed).toBe(1);
    const stored = await t.db.selectFrom('content_comments').select(['reply_status', 'reply_error'])
      .where('provider_comment_id', '=', 'c_fail_1').executeTakeFirst();
    expect(stored!.reply_status).toBe('failed');
    expect(stored!.reply_error).toContain('comment deleted');
  });

  it('an order comment gets a DM invite and is flagged for the team', async () => {
    await seedPublishedContent(t, { providerPostId: 'post_order', products: [{ price: 199 }] });
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('post_order/comments')) {
        return jsonRes({ data: [{ id: 'c_order_1', message: 'نبي نطلب اثنين', from: { id: 'u6' }, created_time: new Date().toISOString() }] });
      }
      if (u.includes('/replies')) return jsonRes({ id: 'r_order' });
      return jsonRes({ data: [] });
    });
    await pollAndProcessComments(t.db);
    const stored = await t.db.selectFrom('content_comments').select(['decision', 'reply_text'])
      .where('provider_comment_id', '=', 'c_order_1').executeTakeFirst();
    expect(stored!.decision).toBe('human_attention');
    expect(stored!.reply_text).toContain('رسالة خاصة');
  });
});
