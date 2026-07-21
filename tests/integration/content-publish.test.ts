import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { startPublishing, processPublication, retryPublication, recomputeItemStatus } from '../../integrations/pipelines/content-publish';
import { createTestDatabase, seedProduct, type TestDb } from './setup';

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function seedContentItem(t: TestDb, over: Partial<Record<string, unknown>> = {}) {
  const productId = await seedProduct(t.db);
  const item = await t.db.insertInto('content_items').values({
    title: 'Test drop',
    content_type: 'post',
    platforms: ['facebook', 'instagram'],
    purpose: 'price_drop',
    output_mode: 'original',
    status: 'approved',
    ...(over as any),
  }).returning('id').executeTakeFirst();
  await t.db.insertInto('content_products').values({
    content_item_id: item!.id, product_id: productId, new_price: 189,
  }).execute();
  await t.db.insertInto('content_assets').values({
    content_item_id: item!.id, kind: 'composed',
    public_url: 'https://media.example/content/a.jpg', position: 0,
  }).execute();
  return { itemId: item!.id, productId };
}

describe('exactly-once content publishing', () => {
  let t: TestDb;
  beforeAll(async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'test-token';
    process.env.META_PAGE_ID = 'page123';
    process.env.META_IG_USER_ID = 'ig123';
    t = await createTestDatabase('eh_pub');
  });
  afterAll(async () => {
    delete process.env.META_PAGE_ACCESS_TOKEN;
    delete process.env.META_PAGE_ID;
    delete process.env.META_IG_USER_ID;
    await t.destroy();
  });
  beforeEach(() => vi.restoreAllMocks());

  it('startPublishing is idempotent: one publication row per platform, ever', async () => {
    const { itemId } = await seedContentItem(t);
    const first = await startPublishing(t.db, itemId);
    expect(first.publicationIds).toHaveLength(2);
    const again = await startPublishing(t.db, itemId);
    const rows = await t.db.selectFrom('content_publications').select('id').where('content_item_id', '=', itemId).execute();
    expect(rows).toHaveLength(2);
    expect(again.publicationIds.length).toBeLessThanOrEqual(2);
  });

  it('CONCURRENCY: one publication can never post twice; price activates once', async () => {
    const { itemId, productId } = await seedContentItem(t);
    const { publicationIds } = await startPublishing(t.db, itemId);
    const fbPub = await t.db.selectFrom('content_publications')
      .select('id').where('content_item_id', '=', itemId).where('platform', '=', 'facebook')
      .executeTakeFirst();

    let posts = 0;
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('/photos')) { posts++; return jsonRes({ id: 'photo1', post_id: 'post_1' }); }
      return jsonRes({ id: 'obj' });
    });

    const results = await Promise.all(
      Array.from({ length: 4 }, () => processPublication(t.db, fbPub!.id)),
    );
    expect(results.filter((r) => r === 'published')).toHaveLength(1);
    expect(posts).toBe(1);

    // Price activated exactly once on the FIRST platform success.
    const product = await t.db.selectFrom('products').select('active_price').where('id', '=', productId).executeTakeFirst();
    expect(Number(product!.active_price)).toBe(189);
    const promos = await t.db.selectFrom('promotions').select('id').where('product_id', '=', productId).execute();
    expect(promos).toHaveLength(1);
    expect(publicationIds.length).toBe(2);
  });

  it('partial publication: one platform fails → truthful partial state, price stays live, retry targets ONLY the failed platform', async () => {
    const { itemId, productId } = await seedContentItem(t);
    await startPublishing(t.db, itemId);
    const pubs = await t.db.selectFrom('content_publications')
      .select(['id', 'platform']).where('content_item_id', '=', itemId).execute();
    const fb = pubs.find((p) => p.platform === 'facebook')!;
    const ig = pubs.find((p) => p.platform === 'instagram')!;

    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('page123/photos')) return jsonRes({ id: 'p1', post_id: 'post_fb' });
      if (u.includes('ig123/media')) return jsonRes({ error: { message: 'ig perms missing', code: 100 } }, 400);
      return jsonRes({ id: 'x' });
    });
    // Exhaust IG attempts so it lands in failed (not retry).
    await t.db.updateTable('content_publications').set({ max_attempts: 1 }).where('id', '=', ig.id).execute();

    expect(await processPublication(t.db, fb.id)).toBe('published');
    expect(await processPublication(t.db, ig.id)).toBe('failed');

    const item = await t.db.selectFrom('content_items').select('status').where('id', '=', itemId).executeTakeFirst();
    expect(item!.status).toBe('partially_published');
    const product = await t.db.selectFrom('products').select('active_price').where('id', '=', productId).executeTakeFirst();
    expect(Number(product!.active_price)).toBe(189); // stays active per the brief

    // Retry resets only the failed IG publication; FB stays published.
    expect(await retryPublication(t.db, ig.id)).toBe(true);
    const after = await t.db.selectFrom('content_publications')
      .select(['platform', 'status']).where('content_item_id', '=', itemId).execute();
    expect(after.find((p) => p.platform === 'facebook')!.status).toBe('published');
    expect(after.find((p) => p.platform === 'instagram')!.status).toBe('pending');
  });

  it('a FULLY failed publish never changes a price', async () => {
    const { itemId, productId } = await seedContentItem(t, { platforms: ['facebook'] });
    await startPublishing(t.db, itemId);
    const pub = await t.db.selectFrom('content_publications').select('id').where('content_item_id', '=', itemId).executeTakeFirst();
    await t.db.updateTable('content_publications').set({ max_attempts: 1 }).where('id', '=', pub!.id).execute();
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async () => jsonRes({ error: { message: 'nope', code: 100 } }, 400));
    expect(await processPublication(t.db, pub!.id)).toBe('failed');
    const product = await t.db.selectFrom('products').select('active_price').where('id', '=', productId).executeTakeFirst();
    expect(Number(product!.active_price)).toBe(250); // unchanged
    await recomputeItemStatus(t.db, itemId);
    const item = await t.db.selectFrom('content_items').select('status').where('id', '=', itemId).executeTakeFirst();
    expect(item!.status).toBe('failed');
  });

  it('carousel resume re-uses already-uploaded children (no duplicate uploads)', async () => {
    const { itemId } = await seedContentItem(t, { platforms: ['facebook'] });
    await t.db.insertInto('content_assets').values({
      content_item_id: itemId, kind: 'composed', public_url: 'https://media.example/content/b.jpg', position: 1,
    }).execute();
    await startPublishing(t.db, itemId);
    const pub = await t.db.selectFrom('content_publications').select(['id', 'format']).where('content_item_id', '=', itemId).executeTakeFirst();
    expect(pub!.format).toBe('carousel');

    let uploads = 0;
    // First run: second child upload fails transiently after the first succeeds.
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes('/photos')) {
        uploads++;
        if (uploads === 2) return jsonRes({ error: { message: 'flaky', code: 2 } }, 500);
        return jsonRes({ id: `child_${uploads}` });
      }
      if (u.includes('/feed')) return jsonRes({ id: 'post_carousel' });
      return jsonRes({ id: 'x' });
    });
    expect(await processPublication(t.db, pub!.id)).toBe('retry');
    expect(uploads).toBeGreaterThanOrEqual(2);
    const uploadsBeforeResume = uploads;

    await t.db.updateTable('content_publications').set({ next_attempt_at: new Date().toISOString(), status: 'pending' }).where('id', '=', pub!.id).execute();
    expect(await processPublication(t.db, pub!.id)).toBe('published');
    // Resume uploaded ONLY the missing child (one more /photos call).
    expect(uploads).toBe(uploadsBeforeResume + 1);
  });
});
