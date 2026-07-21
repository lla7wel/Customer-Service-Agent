import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  changePriceManual, changePriceFromImport, activatePriceDrop, endDuePromotions, previousVerifiedPrice,
} from '../../integrations/catalog/pricing';
import { createTestDatabase, seedProduct, type TestDb } from './setup';
import { sql } from 'kysely';

describe('pricing engine', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDatabase('eh_price'); });
  afterAll(async () => { await t.destroy(); });

  it('manual change: versioned history + base_price locked against CSV', async () => {
    const id = await seedProduct(t.db);
    await changePriceManual(t.db, { productId: id, newPrice: 199 });
    const p = await t.db.selectFrom('products')
      .select(['base_price', 'active_price', 'admin_locked_fields'])
      .where('id', '=', id).executeTakeFirst();
    expect(Number(p!.base_price)).toBe(199);
    expect(Number(p!.active_price)).toBe(199);
    expect((p!.admin_locked_fields as any).base_price).toBe(true);
    const history = await t.db.selectFrom('product_price_history')
      .select(['old_price', 'new_price', 'source'])
      .where('product_id', '=', id).orderBy('id', 'desc').executeTakeFirst();
    expect(history).toMatchObject({ new_price: 199, source: 'manual' });
  });

  it('CSV import price update honors the admin lock', async () => {
    const id = await seedProduct(t.db);
    await changePriceManual(t.db, { productId: id, newPrice: 150 });
    const outcome = await changePriceFromImport(t.db, { productId: id, newPrice: 120 });
    expect(outcome).toBe('locked');
    const p = await t.db.selectFrom('products').select('base_price').where('id', '=', id).executeTakeFirst();
    expect(Number(p!.base_price)).toBe(150);
  });

  it('CSV import updates an UNLOCKED price with history', async () => {
    const id = await seedProduct(t.db);
    const outcome = await changePriceFromImport(t.db, { productId: id, newPrice: 210 });
    expect(outcome).toBe('updated');
    const p = await t.db.selectFrom('products').select(['base_price', 'active_price']).where('id', '=', id).executeTakeFirst();
    expect(Number(p!.base_price)).toBe(210);
    expect(Number(p!.active_price)).toBe(210);
  });

  it('price drop: "before" comes from the verified price, activation is idempotent', async () => {
    const id = await seedProduct(t.db); // active 250
    expect(await previousVerifiedPrice(t.db, id)).toBe(250);
    const r1 = await activatePriceDrop(t.db, { contentItemId: null as any, productId: id, newPrice: 189, endsAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(r1).toBe('activated');
    const p = await t.db.selectFrom('products').select(['active_price', 'base_price']).where('id', '=', id).executeTakeFirst();
    expect(Number(p!.active_price)).toBe(189);
    expect(Number(p!.base_price)).toBe(250); // temporary → base untouched
    const promo = await t.db.selectFrom('promotions').select(['previous_price', 'status']).where('product_id', '=', id).executeTakeFirst();
    expect(Number(promo!.previous_price)).toBe(250);
    // A second promotion for the same product is refused (no overlap).
    const r2 = await activatePriceDrop(t.db, { contentItemId: null as any, productId: id, newPrice: 170, endsAt: null });
    expect(r2).toBe('conflict');
  });

  it('a PERMANENT drop (no end date) changes the base price once live', async () => {
    const id = await seedProduct(t.db);
    await activatePriceDrop(t.db, { contentItemId: null as any, productId: id, newPrice: 175, endsAt: null });
    const p = await t.db.selectFrom('products').select(['base_price', 'active_price']).where('id', '=', id).executeTakeFirst();
    expect(Number(p!.base_price)).toBe(175);
    expect(Number(p!.active_price)).toBe(175);
  });

  it('an expired promotion restores the correct prior price automatically', async () => {
    const id = await seedProduct(t.db); // 250
    await activatePriceDrop(t.db, { contentItemId: null as any, productId: id, newPrice: 189, endsAt: new Date(Date.now() + 1000).toISOString() });
    await sql`update promotions set ends_at = now() - interval '1 minute' where product_id = ${id}`.execute(t.db);
    const ended = await endDuePromotions(t.db);
    expect(ended).toBeGreaterThanOrEqual(1);
    const p = await t.db.selectFrom('products').select('active_price').where('id', '=', id).executeTakeFirst();
    expect(Number(p!.active_price)).toBe(250);
    const restoreRow = await t.db.selectFrom('product_price_history')
      .select(['source', 'new_price']).where('product_id', '=', id)
      .orderBy('id', 'desc').executeTakeFirst();
    expect(restoreRow).toMatchObject({ source: 'promotion_end', new_price: 250 });
  });

  it('a promotion NEVER overwrites a later manual price', async () => {
    const id = await seedProduct(t.db); // 250
    await activatePriceDrop(t.db, { contentItemId: null as any, productId: id, newPrice: 189, endsAt: new Date(Date.now() + 3600_000).toISOString() });
    // Admin sets a newer price mid-promotion → promotion is superseded forever.
    await changePriceManual(t.db, { productId: id, newPrice: 300 });
    await sql`update promotions set ends_at = now() - interval '1 minute', status = 'active' where product_id = ${id}`.execute(t.db);
    await endDuePromotions(t.db);
    const p = await t.db.selectFrom('products').select('active_price').where('id', '=', id).executeTakeFirst();
    expect(Number(p!.active_price)).toBe(300); // manual price wins
  });

  it('a later CSV price retargets an open promotion restore value', async () => {
    const id = await seedProduct(t.db); // 250
    await activatePriceDrop(t.db, { contentItemId: null as any, productId: id, newPrice: 189, endsAt: new Date(Date.now() + 3600_000).toISOString() });
    const outcome = await changePriceFromImport(t.db, { productId: id, newPrice: 230 });
    expect(outcome).toBe('updated');
    const p1 = await t.db.selectFrom('products').select('active_price').where('id', '=', id).executeTakeFirst();
    expect(Number(p1!.active_price)).toBe(189); // promo still owns the live price
    await sql`update promotions set ends_at = now() - interval '1 minute' where product_id = ${id}`.execute(t.db);
    await endDuePromotions(t.db);
    const p2 = await t.db.selectFrom('products').select('active_price').where('id', '=', id).executeTakeFirst();
    expect(Number(p2!.active_price)).toBe(230); // restores to the NEWER CSV price
  });
});
