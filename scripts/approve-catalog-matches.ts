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
import { config } from 'dotenv';
import path from 'node:path';

config({ path: path.resolve(new URL('.', import.meta.url).pathname, '../.env') });
config();

import { requireDb } from '../integrations/db/client';

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

const db = requireDb();

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
  const rows = (await db
    .selectFrom('catalog_match_suggestions')
    .select(['id', 'csv_product_id', 'scraper_product_id', 'score', 'confidence', 'evidence'])
    .where('state', '=', 'possible')
    .orderBy('score', (ob) => ob.desc().nullsLast())
    .execute()) as unknown as SuggestionRow[];
  return limit ? rows.slice(0, limit) : rows;
}

async function loadProducts(ids: string[]): Promise<Map<string, ProductRow>> {
  const map = new Map<string, ProductRow>();
  for (const idsChunk of chunk(Array.from(new Set(ids)), 100)) {
    const data = await retry('load_products', () => db
      .selectFrom('products')
      .select(['id', 'source', 'status', 'base_price', 'primary_image_id', 'source_name', 'product_code', 'raw'])
      .where('id', 'in', idsChunk)
      .execute());
    for (const p of data as unknown as ProductRow[]) map.set(p.id, p);
  }
  return map;
}

async function loadImages(scraperIds: string[]): Promise<Map<string, ImageRow[]>> {
  const map = new Map<string, ImageRow[]>();
  for (const idsChunk of chunk(Array.from(new Set(scraperIds)), 100)) {
    const data = await retry('load_images', () => db
      .selectFrom('product_images')
      .select(['id', 'product_id', 'position', 'is_primary', 'public_url'])
      .where('product_id', 'in', idsChunk)
      .orderBy('position', 'asc')
      .execute());
    for (const img of data as unknown as ImageRow[]) {
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

  try {
    await db.updateTable('product_images').set({ product_id: row.csv_product_id }).where('product_id', '=', scraperId).execute();
  } catch (e: any) { return { ok: false, reason: `move_images:${e?.message}` }; }

  try {
    await db.updateTable('products').set({
      primary_image_id: primary.id,
      raw: JSON.stringify(appendRawEvent(csv.raw, 'catalog_match_attached', baseEvent)),
    }).where('id', '=', row.csv_product_id).execute();
  } catch (e: any) { return { ok: false, reason: `update_csv:${e?.message}` }; }

  try {
    await db.updateTable('products').set({
      status: 'archived',
      primary_image_id: null,
      raw: JSON.stringify({
        ...asRecord(scraper.raw),
        catalog_match_merged_into: {
          csv_product_id: row.csv_product_id,
          image_count: imgs.length,
          merged_at: attachedAt,
          mode: 'bulk_approve',
          suggestion_id: row.id,
        },
      }),
    }).where('id', '=', scraperId).execute();
  } catch (e: any) { return { ok: false, reason: `archive_scraper:${e?.message}` }; }

  try {
    await db.updateTable('catalog_match_suggestions').set({
      state: 'approved',
      reviewed_at: attachedAt,
      evidence: JSON.stringify({ ...(row.evidence ?? {}), mode: 'bulk_approve', image_count: imgs.length, scraper_source_name: scraper.source_name }),
    }).where('id', '=', row.id).execute();
  } catch (e: any) { return { ok: false, reason: `update_suggestion:${e?.message}` }; }

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
        meta: JSON.stringify({
          csv_product_id: item.row.csv_product_id,
          scraper_product_id: item.row.scraper_product_id,
          image_count: r.moved,
          suggestion_id: item.row.id,
          confidence: item.row.confidence,
          score: item.row.score,
        }),
      });
    } else {
      result.failed[r.reason] = (result.failed[r.reason] ?? 0) + 1;
    }
    if ((i + 1) % 50 === 0) {
      console.log(`progress ${i + 1}/${valid.length} approved=${result.approved}`);
    }
    if (logs.length >= 200) {
      await db.insertInto('activity_logs').values(logs.splice(0, logs.length) as any[]).execute();
    }
  }
  if (logs.length) await db.insertInto('activity_logs').values(logs as any[]).execute();

  for (let i = 0; i < invalidRows.length; i++) {
    const { row, reason } = invalidRows[i];
    try {
      await db.updateTable('catalog_match_suggestions').set({
        state: 'needs_review',
        reviewed_at: new Date().toISOString(),
        evidence: JSON.stringify({ ...(row.evidence ?? {}), bulk_approve_skipped: true, skip_reason: reason }),
      }).where('id', '=', row.id).execute();
      result.marked_invalid_needs_review++;
    } catch (e: any) {
      const key = `mark_invalid:${e?.message}`;
      result.failed[key] = (result.failed[key] ?? 0) + 1;
    }
    if ((i + 1) % 200 === 0) console.log(`marked invalid ${i + 1}/${invalidRows.length}`);
  }
}

console.log(JSON.stringify(result, null, 2));
