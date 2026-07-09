/**
 * Shared catalog-match approval logic — used by BOTH the single approve route
 * and the bulk approve route so there is one source of truth for the safe write
 * sequence (move scraper images → CSV product, point primary image, archive the
 * merged scraper duplicate, persist suggestion state). Every guard returns a
 * skip reason instead of throwing, so bulk approve can skip conflicts cleanly.
 */
import type { DB, Kysely } from '@integrations/db/client';

export interface ApproveResult {
  ok: boolean;
  reason?: string;
  moved?: number;
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}
function appendRawEvent(raw: unknown, key: string, event: Record<string, unknown>) {
  const obj = asRecord(raw);
  const existing = Array.isArray(obj[key]) ? (obj[key] as unknown[]) : [];
  return { ...obj, [key]: [event, ...existing].slice(0, 30) };
}

interface ImageRow { id: string; position: number; is_primary: boolean; public_url: string | null }

/**
 * Approve ONE csv↔scraper match. Safe + idempotent-ish: refuses to clobber a CSV
 * product that already has a primary image, refuses non-active/priced targets,
 * refuses archived/non-scraper sources, and refuses sources with no images.
 */
export async function approveOne(db: Kysely<DB>, csvId: string, scraperId: string, mode = 'manual_approve'): Promise<ApproveResult> {
  if (!csvId || !scraperId || csvId === scraperId) return { ok: false, reason: 'invalid_ids' };

  const csv = await db
    .selectFrom('products')
    .select(['id', 'source', 'status', 'base_price', 'primary_image_id', 'raw'])
    .where('id', '=', csvId).executeTakeFirst();
  if (!csv) return { ok: false, reason: 'csv_not_found' };
  if (csv.source !== 'csv' || csv.status !== 'active' || csv.base_price == null) return { ok: false, reason: 'target_not_active_priced_csv' };
  if (csv.primary_image_id) return { ok: false, reason: 'csv_already_has_image' };

  const scraper = await db
    .selectFrom('products')
    .select(['id', 'source', 'status', 'source_name', 'product_code', 'raw'])
    .where('id', '=', scraperId).executeTakeFirst();
  if (!scraper) return { ok: false, reason: 'scraper_not_found' };
  if (scraper.source !== 'scraper' || scraper.status === 'archived') return { ok: false, reason: 'source_not_open_scraper' };

  let imgs: ImageRow[];
  try {
    imgs = (await db
      .selectFrom('product_images')
      .select(['id', 'position', 'is_primary', 'public_url'])
      .where('product_id', '=', scraperId)
      .orderBy('position', 'asc')
      .execute()) as ImageRow[];
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'images_query_failed' };
  }
  if (imgs.length === 0) return { ok: false, reason: 'no_images_on_source' };

  try {
    await db.updateTable('product_images').set({ product_id: csvId }).where('product_id', '=', scraperId).execute();
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'image_move_failed' };
  }

  const primary = imgs.find((i) => i.public_url) ?? imgs[0];
  const attachedAt = new Date().toISOString();
  if (primary) {
    try {
      await db
        .updateTable('products')
        .set({
          primary_image_id: primary.id,
          raw: JSON.stringify(appendRawEvent(csv.raw, 'catalog_match_attached', {
            scraper_product_id: scraperId, scraper_product_code: scraper.product_code,
            scraper_source_name: scraper.source_name, image_count: imgs.length, attached_at: attachedAt, mode,
          })),
        })
        .where('id', '=', csvId).execute();
    } catch (e: any) {
      return { ok: false, reason: e?.message ?? 'csv_update_failed' };
    }
  }

  try {
    await db
      .updateTable('products')
      .set({
        status: 'archived', primary_image_id: null,
        raw: JSON.stringify({ ...asRecord(scraper.raw), catalog_match_merged_into: { csv_product_id: csvId, image_count: imgs.length, merged_at: attachedAt, mode } }),
      })
      .where('id', '=', scraperId).execute();
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'archive_failed' };
  }

  await db.insertInto('catalog_match_suggestions').values({
    csv_product_id: csvId, scraper_product_id: scraperId, state: 'approved', reviewed_at: attachedAt,
    evidence: JSON.stringify({ mode, image_count: imgs.length, scraper_source_name: scraper.source_name }),
  }).onConflict((oc) => oc.column('csv_product_id').doUpdateSet({
    scraper_product_id: (eb) => eb.ref('excluded.scraper_product_id'),
    state: (eb) => eb.ref('excluded.state'),
    reviewed_at: (eb) => eb.ref('excluded.reviewed_at'),
    evidence: (eb) => eb.ref('excluded.evidence'),
  })).execute();

  await db.insertInto('activity_logs').values({
    actor_type: 'human', action: 'catalog_image_match_approved', entity_type: 'product', entity_id: csvId,
    summary: `Attached ${imgs.length} scraped images from ${scraperId} to CSV product ${csvId}`,
    meta: JSON.stringify({ csv_product_id: csvId, scraper_product_id: scraperId, scraper_source_name: scraper.source_name, image_count: imgs.length, duplicate_archived: true, mode }),
  }).execute();

  return { ok: true, moved: imgs.length };
}
