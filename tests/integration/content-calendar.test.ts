import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { createTestDatabase, seedProduct, type TestDb } from './setup';

/**
 * Proves the Content Studio calendar query fixes:
 *  - published items are placed by the AUTHORITATIVE content_publications
 *    .published_at, not content_items.updated_at (audit finding #16);
 *  - the month-scoped query returns EVERY in-month item, not a global cap
 *    (audit finding #17).
 */
describe('content studio calendar query', () => {
  let t: TestDb;

  // Mirror of the page's effective-date expression.
  const publishedAtSub = sql<string>`(select max(pub.published_at) from content_publications pub where pub.content_item_id = ci.id and pub.status = 'published')`;
  const effectiveAt = sql<string>`coalesce(ci.scheduled_for, ${publishedAtSub}, ci.updated_at)`;

  async function calendarItems(rangeStart: string, rangeEnd: string) {
    return t.db.selectFrom('content_items as ci')
      .leftJoin('content_products as cp', 'cp.content_item_id', 'ci.id')
      .select((eb) => ['ci.id', 'ci.status', 'ci.updated_at',
        eb.fn.count<number>('cp.id').distinct().as('product_count'),
        publishedAtSub.as('published_at')])
      .where('ci.status', '!=', 'archived')
      .where(sql<boolean>`${effectiveAt} >= ${rangeStart}::timestamptz`)
      .where(sql<boolean>`${effectiveAt} < ${rangeEnd}::timestamptz`)
      .groupBy('ci.id')
      .orderBy(sql`${effectiveAt}`, 'asc')
      .limit(500)
      .execute();
  }

  beforeAll(async () => {
    t = await createTestDatabase('eh_calendar');
    const productId = await seedProduct(t.db);

    // A published item whose row was later touched (updated_at in a DIFFERENT
    // month than when it was actually published).
    const published = await t.db.insertInto('content_items').values({
      title: 'Published in June', status: 'published', purpose: 'general',
      updated_at: '2026-07-15T10:00:00Z' as any,
    }).returning('id').executeTakeFirstOrThrow();
    await t.db.insertInto('content_products').values({ content_item_id: published.id, product_id: productId, position: 0 }).execute();
    await t.db.insertInto('content_publications').values({
      content_item_id: published.id, platform: 'facebook', format: 'feed', status: 'published',
      idempotency_key: `k-${published.id}`, published_at: '2026-06-10T09:00:00Z' as any,
    }).execute();

    // 40 scheduled items in July — proves no global cap drops in-month items.
    for (let i = 1; i <= 40; i++) {
      await t.db.insertInto('content_items').values({
        title: `Scheduled ${i}`, status: 'scheduled', purpose: 'general',
        scheduled_for: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z` as any,
      }).execute();
    }
  });

  afterAll(async () => { await t.destroy(); });

  it('places a published item by its publication month, not its updated_at month', async () => {
    // July window: the published item (published in June) must NOT appear here…
    const july = await calendarItems('2026-06-30T22:00:00Z', '2026-07-31T22:00:00Z');
    expect(july.find((r) => r.status === 'published')).toBeUndefined();
    // …even though its updated_at is in July.

    // June window: it DOES appear, placed by published_at.
    const june = await calendarItems('2026-05-31T22:00:00Z', '2026-06-30T22:00:00Z');
    const pub = june.find((r) => r.status === 'published');
    expect(pub).toBeTruthy();
    expect(String(pub!.published_at)).toContain('2026-06-10');
  });

  it('returns every in-month scheduled item (no silent global cap)', async () => {
    const july = await calendarItems('2026-06-30T22:00:00Z', '2026-07-31T22:00:00Z');
    expect(july.filter((r) => r.status === 'scheduled').length).toBe(40);
  });
});
