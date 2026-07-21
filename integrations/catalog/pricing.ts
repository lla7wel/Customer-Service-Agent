/**
 * Pricing engine — the single owner of every price mutation.
 *
 * Invariants (owner brief — cannot be violated):
 *   * only admins and CSV imports write prices; the AI never does;
 *   * every change is versioned in product_price_history;
 *   * a price-drop's "before" price is the previous VERIFIED price from
 *     history — never a guess, never a stale campaign image;
 *   * a temporary promotion restores the correct prior price automatically and
 *     NEVER overwrites a later manual/CSV price;
 *   * overlapping promotions are impossible (partial unique index) — starting
 *     a new one requires the open one to be ended/cancelled first;
 *   * the customer-facing truth is products.active_price, updated in the same
 *     transaction as the history/promotion rows.
 */
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/types';
import { lockEditedFields } from '../product-locks';

export type PriceSource = 'manual' | 'csv_import' | 'promotion_start' | 'promotion_end';

export class PromotionConflictError extends Error {
  constructor(productId: string) {
    super(`Product ${productId} already has an open promotion. End or cancel it before starting another.`);
    this.name = 'PromotionConflictError';
  }
}

/** The latest verified price BEFORE any currently-active promotion. */
export async function previousVerifiedPrice(db: Kysely<DB> | Transaction<DB>, productId: string): Promise<number | null> {
  const product = await db
    .selectFrom('products')
    .select(['base_price', 'active_price'])
    .where('id', '=', productId)
    .executeTakeFirst();
  if (!product) return null;
  const openPromo = await db
    .selectFrom('promotions')
    .select(['previous_price'])
    .where('product_id', '=', productId)
    .where('status', 'in', ['pending', 'active'])
    .executeTakeFirst();
  if (openPromo) return Number(openPromo.previous_price);
  return product.active_price != null ? Number(product.active_price) : (product.base_price != null ? Number(product.base_price) : null);
}

/**
 * Admin manual price change. Locks base_price against CSV overwrite, ends any
 * open promotion (later manual price wins), records history.
 */
export async function changePriceManual(
  db: Kysely<DB>,
  args: { productId: string; newPrice: number; adminId?: string | null; note?: string },
): Promise<void> {
  if (!(args.newPrice > 0)) throw new Error('price must be positive');
  await db.transaction().execute(async (trx) => {
    const product = await trx
      .selectFrom('products')
      .select(['id', 'base_price', 'active_price', 'admin_locked_fields'])
      .where('id', '=', args.productId)
      .forUpdate()
      .executeTakeFirst();
    if (!product) throw new Error('product not found');

    // A later manual price supersedes any open promotion permanently.
    await trx
      .updateTable('promotions')
      .set({ status: 'ended' })
      .where('product_id', '=', args.productId)
      .where('status', 'in', ['pending', 'active'])
      .execute();

    await trx
      .updateTable('products')
      .set({
        base_price: args.newPrice,
        active_price: args.newPrice,
        campaign_price: null,
        admin_locked_fields: JSON.stringify(lockEditedFields(product.admin_locked_fields, { base_price: true })),
      })
      .where('id', '=', args.productId)
      .execute();

    await trx
      .insertInto('product_price_history')
      .values({
        product_id: args.productId,
        old_price: product.active_price ?? product.base_price ?? null,
        new_price: args.newPrice,
        source: 'manual',
        changed_by: args.adminId ?? null,
        note: args.note ?? null,
      })
      .execute();
  });
}

/**
 * CSV import price update. Skips locked base_price; never touches a product
 * whose open promotion holds active_price (the import updates base_price
 * only — the promotion's own end restores against the NEW base).
 */
export async function changePriceFromImport(
  trx: Kysely<DB> | Transaction<DB>,
  args: { productId: string; newPrice: number; importRunId?: string | null },
): Promise<'updated' | 'locked' | 'unchanged'> {
  const product = await trx
    .selectFrom('products')
    .select(['id', 'base_price', 'active_price', 'admin_locked_fields'])
    .where('id', '=', args.productId)
    .executeTakeFirst();
  if (!product) return 'unchanged';
  const locks = (product.admin_locked_fields ?? {}) as Record<string, unknown>;
  if (locks.base_price === true) return 'locked';
  if (product.base_price != null && Number(product.base_price) === args.newPrice) return 'unchanged';

  const openPromo = await trx
    .selectFrom('promotions')
    .select(['id', 'promo_price'])
    .where('product_id', '=', args.productId)
    .where('status', 'in', ['pending', 'active'])
    .executeTakeFirst();

  await trx
    .updateTable('products')
    .set({
      base_price: args.newPrice,
      // Active price follows the import unless a promotion currently owns it.
      ...(openPromo ? {} : { active_price: args.newPrice, campaign_price: null }),
    })
    .where('id', '=', args.productId)
    .execute();
  // Keep the promotion's restore target in sync with the newer CSV price
  // ("a promotion must never overwrite a later CSV price").
  if (openPromo) {
    await trx
      .updateTable('promotions')
      .set({ previous_price: args.newPrice })
      .where('id', '=', openPromo.id)
      .execute();
  }
  await trx
    .insertInto('product_price_history')
    .values({
      product_id: args.productId,
      old_price: product.base_price ?? null,
      new_price: args.newPrice,
      source: 'csv_import',
      import_run_id: args.importRunId ?? null,
    })
    .execute();
  return 'updated';
}

/**
 * Activate a price drop when its content goes live (first platform success).
 * Idempotent per (content item, product). Permanent drops (no end date) change
 * the base price; temporary promotions only change the active price.
 */
export async function activatePriceDrop(
  db: Kysely<DB>,
  args: { contentItemId: string; productId: string; newPrice: number; endsAt?: string | null; adminId?: string | null },
): Promise<'activated' | 'already_active' | 'conflict'> {
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('promotions')
      .select(['id', 'status'])
      .where('content_item_id', '=', args.contentItemId)
      .where('product_id', '=', args.productId)
      .executeTakeFirst();
    if (existing && existing.status !== 'cancelled') return 'already_active';

    const other = await trx
      .selectFrom('promotions')
      .select('id')
      .where('product_id', '=', args.productId)
      .where('status', 'in', ['pending', 'active'])
      .executeTakeFirst();
    if (other) return 'conflict';

    const product = await trx
      .selectFrom('products')
      .select(['base_price', 'active_price'])
      .where('id', '=', args.productId)
      .forUpdate()
      .executeTakeFirst();
    if (!product) return 'conflict';
    const previous = product.active_price != null ? Number(product.active_price) : Number(product.base_price ?? args.newPrice);
    const permanent = !args.endsAt;

    await trx
      .insertInto('promotions')
      .values({
        product_id: args.productId,
        content_item_id: args.contentItemId,
        promo_price: args.newPrice,
        previous_price: previous,
        starts_at: new Date().toISOString(),
        ends_at: args.endsAt ?? null,
        status: permanent ? 'ended' : 'active', // a permanent drop IS the new price; nothing to restore
        created_by: args.adminId ?? null,
      })
      .execute();

    await trx
      .updateTable('products')
      .set(permanent
        ? { base_price: args.newPrice, active_price: args.newPrice, campaign_price: null }
        : { active_price: args.newPrice, campaign_price: args.newPrice })
      .where('id', '=', args.productId)
      .execute();

    await trx
      .insertInto('product_price_history')
      .values({
        product_id: args.productId,
        old_price: previous,
        new_price: args.newPrice,
        source: 'promotion_start',
        content_item_id: args.contentItemId,
        changed_by: args.adminId ?? null,
        note: permanent ? 'permanent price drop (content published)' : `promotion until ${args.endsAt}`,
      })
      .execute();
    return 'activated';
  });
}

/**
 * End expired promotions, restoring the correct prior price — unless a later
 * manual/CSV change already owns the price (then only the status flips).
 */
export async function endDuePromotions(db: Kysely<DB>): Promise<number> {
  const due = await db
    .selectFrom('promotions')
    .select(['id', 'product_id', 'promo_price', 'previous_price'])
    .where('status', '=', 'active')
    .where('ends_at', 'is not', null)
    .where('ends_at', '<=', new Date().toISOString())
    .execute();
  let ended = 0;
  for (const promo of due) {
    await db.transaction().execute(async (trx) => {
      const claimed = await trx
        .updateTable('promotions')
        .set({ status: 'ended' })
        .where('id', '=', promo.id)
        .where('status', '=', 'active')
        .returning('id')
        .executeTakeFirst();
      if (!claimed) return;
      const product = await trx
        .selectFrom('products')
        .select(['active_price', 'base_price'])
        .where('id', '=', promo.product_id)
        .forUpdate()
        .executeTakeFirst();
      if (!product) return;
      // Restore ONLY if the promo price is still the live price.
      if (product.active_price != null && Number(product.active_price) === Number(promo.promo_price)) {
        const restore = Number(promo.previous_price);
        await trx
          .updateTable('products')
          .set({ active_price: restore, campaign_price: null })
          .where('id', '=', promo.product_id)
          .execute();
        await trx
          .insertInto('product_price_history')
          .values({
            product_id: promo.product_id,
            old_price: Number(promo.promo_price),
            new_price: restore,
            source: 'promotion_end',
            note: 'promotion expired — prior price restored',
          })
          .execute();
      }
      ended++;
    });
  }
  return ended;
}
