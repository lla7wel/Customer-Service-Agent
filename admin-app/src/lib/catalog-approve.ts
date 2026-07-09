/**
 * Shared catalog-match approval logic — used by BOTH the single approve route
 * and the bulk approve route so there is one source of truth for the safe write
 * sequence (move scraper images → CSV product, point primary image, archive the
 * merged scraper duplicate, persist suggestion state). Every guard returns a
 * skip reason instead of throwing, so bulk approve can skip conflicts cleanly.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

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
export async function approveOne(db: SupabaseClient, csvId: string, scraperId: string, mode = 'manual_approve'): Promise<ApproveResult> {
  if (!csvId || !scraperId || csvId === scraperId) return { ok: false, reason: 'invalid_ids' };

  const { data: csv } = await db
    .from('products')
    .select('id, source, status, base_price, primary_image_id, raw')
    .eq('id', csvId).maybeSingle();
  if (!csv) return { ok: false, reason: 'csv_not_found' };
  if (csv.source !== 'csv' || csv.status !== 'active' || csv.base_price == null) return { ok: false, reason: 'target_not_active_priced_csv' };
  if (csv.primary_image_id) return { ok: false, reason: 'csv_already_has_image' };

  const { data: scraper } = await db
    .from('products')
    .select('id, source, status, source_name, product_code, raw')
    .eq('id', scraperId).maybeSingle();
  if (!scraper) return { ok: false, reason: 'scraper_not_found' };
  if (scraper.source !== 'scraper' || scraper.status === 'archived') return { ok: false, reason: 'source_not_open_scraper' };

  const { data: imgsData, error: imgErr } = await db
    .from('product_images')
    .select('id, position, is_primary, public_url')
    .eq('product_id', scraperId)
    .order('position', { ascending: true });
  if (imgErr) return { ok: false, reason: imgErr.message };
  const imgs = (imgsData ?? []) as ImageRow[];
  if (imgs.length === 0) return { ok: false, reason: 'no_images_on_source' };

  const { error: moveErr } = await db.from('product_images').update({ product_id: csvId }).eq('product_id', scraperId);
  if (moveErr) return { ok: false, reason: moveErr.message };

  const primary = imgs.find((i) => i.public_url) ?? imgs[0];
  const attachedAt = new Date().toISOString();
  if (primary) {
    const { error: csvUpdateErr } = await db
      .from('products')
      .update({
        primary_image_id: primary.id,
        raw: appendRawEvent(csv.raw, 'catalog_match_attached', {
          scraper_product_id: scraperId, scraper_product_code: scraper.product_code,
          scraper_source_name: scraper.source_name, image_count: imgs.length, attached_at: attachedAt, mode,
        }),
      })
      .eq('id', csvId);
    if (csvUpdateErr) return { ok: false, reason: csvUpdateErr.message };
  }

  const { error: archiveErr } = await db
    .from('products')
    .update({
      status: 'archived', primary_image_id: null,
      raw: { ...asRecord(scraper.raw), catalog_match_merged_into: { csv_product_id: csvId, image_count: imgs.length, merged_at: attachedAt, mode } },
    })
    .eq('id', scraperId);
  if (archiveErr) return { ok: false, reason: archiveErr.message };

  await db.from('catalog_match_suggestions').upsert(
    {
      csv_product_id: csvId, scraper_product_id: scraperId, state: 'approved', reviewed_at: attachedAt,
      evidence: { mode, image_count: imgs.length, scraper_source_name: scraper.source_name },
    },
    { onConflict: 'csv_product_id' },
  );

  await db.from('activity_logs').insert({
    actor_type: 'human', action: 'catalog_image_match_approved', entity_type: 'product', entity_id: csvId,
    summary: `Attached ${imgs.length} scraped images from ${scraperId} to CSV product ${csvId}`,
    meta: { csv_product_id: csvId, scraper_product_id: scraperId, scraper_source_name: scraper.source_name, image_count: imgs.length, duplicate_archived: true, mode },
  });

  return { ok: true, moved: imgs.length };
}
