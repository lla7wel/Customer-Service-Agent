/**
 * Safely bulk-approve persisted catalog match suggestions.
 *
 * This uses the same data contract as /api/catalog-match/approve:
 * - CSV product remains catalog truth (name/price untouched)
 * - scraper product contributes images only
 * - scraper duplicate is archived after its images move
 *
 * Default is dry-run. Apply with: npx tsx approve-catalog-matches.ts --apply
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'node:path';

config({ path: path.resolve(new URL('.', import.meta.url).pathname, '../.env') });
config();

type ProductRow = {
  id: string;
  source: string | null;
  status: string | null;
  base_price: number | null;
  primary_image_id: string | null;
  source_name: string | null;
  product_code: string | null;
  raw: unknown;
};
type SuggestionRow = {
  id: string;
  csv_product_id: string;
  scraper_product_id: string | null;
  score: number | null;
  confidence: string | null;
  evidence: Record<string, unknown> | null;
};
type ImageRow = {
  id: string;
  product_id: string;
  position: number | null;
  is_primary: boolean | null;
  public_url: string | null;
};

const apply = process.argv.includes('--apply');
const limitArg = process.argv.find((x) => x.startsWith('--limit='));
const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 0) : null;
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.log(JSON.stringify({
    ok: false,
    error: 'missing_supabase_env',
    missing: [
      !url ? 'SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL' : null,
      !key ? 'SUPABASE_SERVICE_ROLE_KEY' : null,
    ].filter(Boolean),
  }, null, 2));
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function retry<T>(label: string, fn: () => PromiseLike<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < tries) await new Promise((r) => setTimeout(r, i * 750));
    }
  }
  throw new Error(`${label}: ${last instanceof Error ? last.message : String(last)}`);
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

function appendRawEvent(raw: unknown, key: string, event: Record<string, unknown>) {
  const obj = asRecord(raw);
  const existing = Array.isArray(obj[key]) ? (obj[key] as unknown[]) : [];
  return { ...obj, [key]: [event, ...existing].slice(0, 30) };
}

async function loadPossible(): Promise<SuggestionRow[]> {
  const rows: SuggestionRow[] = [];
  for (let from = 0;; from += 1000) {
    const { data, error } = await db
      .from('catalog_match_suggestions')
      .select('id, csv_product_id, scraper_product_id, score, confidence, evidence')
      .eq('state', 'possible')
      .order('score', { ascending: false, nullsFirst: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as SuggestionRow[]));
    if (!data || data.length < 1000) break;
  }
  return limit ? rows.slice(0, limit) : rows;
}

async function loadProducts(ids: string[]): Promise<Map<string, ProductRow>> {
  const map = new Map<string, ProductRow>();
  for (const idsChunk of chunk(Array.from(new Set(ids)), 100)) {
    const { data, error } = await retry('load_products', () => db
      .from('products')
      .select('id, source, status, base_price, primary_image_id, source_name, product_code, raw')
      .in('id', idsChunk));
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as ProductRow[]) map.set(p.id, p);
  }
  return map;
}

async function loadImages(scraperIds: string[]): Promise<Map<string, ImageRow[]>> {
  const map = new Map<string, ImageRow[]>();
  for (const idsChunk of chunk(Array.from(new Set(scraperIds)), 100)) {
    const { data, error } = await retry('load_images', () => db
      .from('product_images')
      .select('id, product_id, position, is_primary, public_url')
      .in('product_id', idsChunk)
      .order('position', { ascending: true }));
    if (error) throw new Error(error.message);
    for (const img of (data ?? []) as ImageRow[]) {
      const arr = map.get(img.product_id) ?? [];
      arr.push(img);
      map.set(img.product_id, arr);
    }
  }
  return map;
}

function invalidReason(row: SuggestionRow, csv: ProductRow | undefined, scraper: ProductRow | undefined, imgs: ImageRow[], duplicateScraperLoser: boolean): string | null {
  if (!row.csv_product_id || !row.scraper_product_id) return 'missing_required_ids';
  if (row.csv_product_id === row.scraper_product_id) return 'same_csv_and_scraper_id';
  if (duplicateScraperLoser) return 'duplicate_scraper_product_id_loser';
  if (!csv) return 'csv_not_found';
  if (csv.source !== 'csv') return 'target_is_not_csv_product';
  if (csv.status !== 'active') return 'target_is_not_active';
  if (csv.base_price == null) return 'target_is_not_priced';
  if (csv.primary_image_id) return 'csv_already_has_primary_image';
  if (!scraper) return 'scraper_not_found';
  if (scraper.source !== 'scraper') return 'source_is_not_scraper_product';
  if (scraper.status === 'archived') return 'source_already_archived';
  if (!imgs.length) return 'no_images_on_source';
  return null;
}

async function approve(row: SuggestionRow, csv: ProductRow, scraper: ProductRow, imgs: ImageRow[]): Promise<{ ok: true; moved: number } | { ok: false; reason: string }> {
  const scraperId = row.scraper_product_id as string;
  const primary = imgs.find((i) => i.public_url) ?? imgs[0];
  const attachedAt = new Date().toISOString();
  const baseEvent = {
    scraper_product_id: scraperId,
    scraper_product_code: scraper.product_code,
    scraper_source_name: scraper.source_name,
    image_count: imgs.length,
    attached_at: attachedAt,
    mode: 'bulk_approve',
    suggestion_id: row.id,
    confidence: row.confidence,
    score: row.score,
  };

  const move = await db.from('product_images').update({ product_id: row.csv_product_id }).eq('product_id', scraperId);
  if (move.error) return { ok: false, reason: `move_images:${move.error.message}` };

  const csvUpdate = await db.from('products').update({
    primary_image_id: primary.id,
    raw: appendRawEvent(csv.raw, 'catalog_match_attached', baseEvent),
  }).eq('id', row.csv_product_id);
  if (csvUpdate.error) return { ok: false, reason: `update_csv:${csvUpdate.error.message}` };

  const archive = await db.from('products').update({
    status: 'archived',
    primary_image_id: null,
    raw: {
      ...asRecord(scraper.raw),
      catalog_match_merged_into: {
        csv_product_id: row.csv_product_id,
        image_count: imgs.length,
        merged_at: attachedAt,
        mode: 'bulk_approve',
        suggestion_id: row.id,
      },
    },
  }).eq('id', scraperId);
  if (archive.error) return { ok: false, reason: `archive_scraper:${archive.error.message}` };

  const suggestion = await db.from('catalog_match_suggestions').update({
    state: 'approved',
    reviewed_at: attachedAt,
    evidence: { ...(row.evidence ?? {}), mode: 'bulk_approve', image_count: imgs.length, scraper_source_name: scraper.source_name },
  }).eq('id', row.id);
  if (suggestion.error) return { ok: false, reason: `update_suggestion:${suggestion.error.message}` };

  return { ok: true, moved: imgs.length };
}

const rows = await loadPossible();
const scraperFrequency = new Map<string, number>();
for (const r of rows) if (r.scraper_product_id) scraperFrequency.set(r.scraper_product_id, (scraperFrequency.get(r.scraper_product_id) ?? 0) + 1);
const scraperWinner = new Map<string, string>();
for (const r of rows) {
  if (!r.scraper_product_id) continue;
  const curId = scraperWinner.get(r.scraper_product_id);
  const cur = curId ? rows.find((x) => x.id === curId) : null;
  if (!cur || (r.score ?? -1) > (cur.score ?? -1)) scraperWinner.set(r.scraper_product_id, r.id);
}

const products = await loadProducts(rows.flatMap((r) => [r.csv_product_id, r.scraper_product_id].filter(Boolean) as string[]));
const images = await loadImages(rows.map((r) => r.scraper_product_id).filter(Boolean) as string[]);
const before = rows.length;
const invalid: Record<string, number> = {};
const invalidRows: Array<{ row: SuggestionRow; reason: string }> = [];
const valid: Array<{ row: SuggestionRow; csv: ProductRow; scraper: ProductRow; imgs: ImageRow[] }> = [];

for (const row of rows) {
  const csv = products.get(row.csv_product_id);
  const scraper = row.scraper_product_id ? products.get(row.scraper_product_id) : undefined;
  const imgs = row.scraper_product_id ? (images.get(row.scraper_product_id) ?? []) : [];
  const duplicateScraperLoser = row.scraper_product_id
    ? (scraperFrequency.get(row.scraper_product_id) ?? 0) > 1 && scraperWinner.get(row.scraper_product_id) !== row.id
    : false;
  const reason = invalidReason(row, csv, scraper, imgs, duplicateScraperLoser);
  if (reason) {
    invalid[reason] = (invalid[reason] ?? 0) + 1;
    invalidRows.push({ row, reason });
  }
  else valid.push({ row, csv: csv as ProductRow, scraper: scraper as ProductRow, imgs });
}

const result = {
  ok: true,
  mode: apply ? 'apply' : 'dry_run',
  pending_before_scanned: before,
  valid_to_approve: valid.length,
  skipped_invalid: invalid,
  approved: 0,
  marked_invalid_needs_review: 0,
  failed: {} as Record<string, number>,
  moved_images: 0,
};

if (apply) {
  const logs: Record<string, unknown>[] = [];
  for (let i = 0; i < valid.length; i++) {
    const item = valid[i];
    const r = await approve(item.row, item.csv, item.scraper, item.imgs);
    if (r.ok) {
      result.approved++;
      result.moved_images += r.moved;
      logs.push({
        actor_type: 'system',
        action: 'catalog_image_match_bulk_approved',
        entity_type: 'product',
        entity_id: item.row.csv_product_id,
        summary: `Attached ${r.moved} scraped images from ${item.row.scraper_product_id} to CSV product ${item.row.csv_product_id}`,
        meta: {
          csv_product_id: item.row.csv_product_id,
          scraper_product_id: item.row.scraper_product_id,
          image_count: r.moved,
          suggestion_id: item.row.id,
          confidence: item.row.confidence,
          score: item.row.score,
        },
      });
    } else {
      result.failed[r.reason] = (result.failed[r.reason] ?? 0) + 1;
    }
    if ((i + 1) % 50 === 0) {
      console.log(`progress ${i + 1}/${valid.length} approved=${result.approved}`);
    }
    if (logs.length >= 200) {
      await db.from('activity_logs').insert(logs.splice(0, logs.length));
    }
  }
  if (logs.length) await db.from('activity_logs').insert(logs);

  for (let i = 0; i < invalidRows.length; i++) {
    const { row, reason } = invalidRows[i];
    const { error } = await db.from('catalog_match_suggestions').update({
      state: 'needs_review',
      reviewed_at: new Date().toISOString(),
      evidence: { ...(row.evidence ?? {}), bulk_approve_skipped: true, skip_reason: reason },
    }).eq('id', row.id);
    if (error) result.failed[`mark_invalid:${error.message}`] = (result.failed[`mark_invalid:${error.message}`] ?? 0) + 1;
    else result.marked_invalid_needs_review++;
    if ((i + 1) % 200 === 0) console.log(`marked invalid ${i + 1}/${invalidRows.length}`);
  }
}

console.log(JSON.stringify(result, null, 2));
