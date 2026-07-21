/**
 * CSV catalog import — the in-app, worker-driven import flow.
 *
 * Rules (owner brief):
 *   * unlocked fields update automatically — there is NO approval queue;
 *   * field-level admin locks always win (products.admin_locked_fields);
 *   * price changes route through the pricing engine (versioned history,
 *     promotion precedence);
 *   * every field change is recorded in product_field_changes for the run,
 *     making the import auditable and rollback-safe;
 *   * duplicate rows inside one CSV are rejected per code (first wins);
 *   * the run summary is truthful: created/updated/locked/skipped/errors.
 *
 * CSV columns (the established catalog.csv shape):
 *   Product Code, Barcode, Product Name, Price, Website URL, Image URL,
 *   Arabic Keywords, Needs Size/Color, English Keywords, Variant Requirement,
 *   Search Text
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { stripLockedFields } from '../product-locks';
import { changePriceFromImport } from './pricing';
import { mediaRoot } from '../storage';

export interface CsvCatalogRow {
  product_code: string;
  barcode: string;
  product_name: string;
  price: number | null;
  website_url: string;
  arabic_keywords: string[];
  needs_size_color: string;
  english_keywords: string[];
  variant_requirement: string;
  search_text: string;
}

/** RFC-4180-ish parser (quotes, embedded commas/newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur); cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const splitKeywords = (raw: string | undefined): string[] =>
  (raw ?? '').split(/[,;،]/).map((k) => k.trim()).filter(Boolean);

export function normalizeCode(code: string | null | undefined): string {
  const c = (code ?? '').trim();
  if (!c) return '';
  const stripped = c.replace(/^0+/, '');
  return stripped || c;
}

export function parseCatalogCsv(text: string): { rows: CsvCatalogRow[]; problems: string[] } {
  const raw = parseCsv(text);
  const problems: string[] = [];
  const rows: CsvCatalogRow[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || !(r[0] ?? '').trim()) continue;
    const code = normalizeCode(r[0]);
    if (!code) { problems.push(`row ${i + 1}: empty product code`); continue; }
    if (seen.has(code)) { problems.push(`row ${i + 1}: duplicate product code ${code} (first occurrence wins)`); continue; }
    seen.add(code);
    const priceRaw = parseFloat((r[3] ?? '').trim());
    rows.push({
      product_code: code,
      barcode: (r[1] ?? '').trim(),
      product_name: (r[2] ?? '').trim(),
      price: Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : null,
      website_url: (r[4] ?? '').trim(),
      arabic_keywords: splitKeywords(r[6]),
      needs_size_color: (r[7] ?? '').trim(),
      english_keywords: splitKeywords(r[8]),
      variant_requirement: (r[9] ?? '').trim(),
      search_text: (r[10] ?? '').trim(),
    });
  }
  return { rows, problems };
}

export function importFilePath(importRunId: string): string {
  const root = mediaRoot();
  if (!root) throw new Error('MEDIA_ROOT is not configured — cannot store import files.');
  return path.join(root, 'imports', `${importRunId}.csv`);
}

export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  priceUpdated: number;
  lockedSkipped: number;
  unchanged: number;
  errors: number;
  problems: string[];
}

/** Worker job: process one uploaded CSV import run. Resumable per product. */
export async function runCsvImportJob(db: Kysely<DB>, importRunId: string): Promise<ImportSummary> {
  const run = await db
    .selectFrom('product_import_runs')
    .select(['id', 'status'])
    .where('id', '=', importRunId)
    .executeTakeFirst();
  if (!run) throw new Error(`import run ${importRunId} not found`);

  const text = await fs.readFile(importFilePath(importRunId), 'utf8');
  const { rows, problems } = parseCatalogCsv(text);
  const summary: ImportSummary = {
    total: rows.length, created: 0, updated: 0, priceUpdated: 0,
    lockedSkipped: 0, unchanged: 0, errors: 0, problems,
  };

  const recordChange = async (
    trx: Kysely<DB>, productId: string, field: string, oldValue: unknown, newValue: unknown,
  ) => {
    await trx.insertInto('product_field_changes').values({
      product_id: productId, import_run_id: importRunId, field,
      old_value: oldValue == null ? null : String(oldValue),
      new_value: newValue == null ? null : String(newValue),
      source: 'csv_import',
    }).execute();
  };

  for (const row of rows) {
    try {
      await db.transaction().execute(async (trx) => {
        const existing = await trx
          .selectFrom('products')
          .select(['id', 'product_code', 'barcode', 'english_name', 'website_url', 'status',
                   'base_price', 'search_keywords', 'arabic_keywords', 'admin_locked_fields', 'variant_attributes'])
          .where((eb) => eb.or([
            eb('product_code', '=', row.product_code),
            ...(row.barcode ? [eb('barcode', '=', row.barcode)] : []),
          ]))
          .limit(1)
          .executeTakeFirst();

        if (!existing) {
          const canActivate = row.price != null && !!row.product_name;
          const inserted = await trx.insertInto('products').values({
            product_code: row.product_code,
            barcode: row.barcode || null,
            english_name: row.product_name || null,
            search_keywords: row.english_keywords,
            arabic_keywords: row.arabic_keywords,
            website_url: row.website_url || null,
            base_price: canActivate ? row.price : null,
            active_price: canActivate ? row.price : null,
            status: canActivate ? 'active' : 'draft',
            availability: 'assume_available',
            source: 'csv',
            import_run_id: importRunId,
            variant_attributes: JSON.stringify({
              needs_size_color: row.needs_size_color || null,
              variant_requirement: row.variant_requirement || null,
            }),
            raw: JSON.stringify({ csv: row }),
          }).returning('id').executeTakeFirst();
          if (inserted && row.price != null) {
            await trx.insertInto('product_price_history').values({
              product_id: inserted.id, old_price: null, new_price: row.price,
              source: 'csv_import', import_run_id: importRunId,
            }).execute();
          }
          summary.created++;
          return;
        }

        // Build the automatic update for UNLOCKED fields only.
        const desired: Record<string, unknown> = {};
        if (row.product_name && row.product_name !== existing.english_name) desired.english_name = row.product_name;
        if (row.barcode && row.barcode !== existing.barcode) desired.barcode = row.barcode;
        if (row.website_url && row.website_url !== existing.website_url) desired.website_url = row.website_url;
        if (row.english_keywords.length && JSON.stringify(row.english_keywords) !== JSON.stringify(existing.search_keywords ?? [])) {
          desired.search_keywords = row.english_keywords;
        }
        if (row.arabic_keywords.length && JSON.stringify(row.arabic_keywords) !== JSON.stringify(existing.arabic_keywords ?? [])) {
          desired.arabic_keywords = row.arabic_keywords;
        }
        const willHavePrice = existing.base_price != null || row.price != null;
        if (existing.status !== 'active' && willHavePrice && (existing.english_name || row.product_name)) {
          desired.status = 'active';
        }
        const safe = stripLockedFields(existing.admin_locked_fields, desired);
        const lockedCount = Object.keys(desired).length - Object.keys(safe).length;
        if (lockedCount > 0) summary.lockedSkipped++;

        if (Object.keys(safe).length) {
          for (const [field, value] of Object.entries(safe)) {
            await recordChange(trx, existing.id, field, (existing as any)[field], value);
          }
          await trx.updateTable('products').set(safe as any).where('id', '=', existing.id).execute();
          summary.updated++;
        }

        if (row.price != null) {
          const priceOutcome = await changePriceFromImport(trx, {
            productId: existing.id, newPrice: row.price, importRunId,
          });
          if (priceOutcome === 'updated') {
            summary.priceUpdated++;
            await recordChange(trx, existing.id, 'base_price', existing.base_price, row.price);
          } else if (priceOutcome === 'locked') {
            summary.lockedSkipped++;
          }
        }
        if (!Object.keys(safe).length && row.price == null) summary.unchanged++;
      });
    } catch (e: any) {
      summary.errors++;
      summary.problems.push(`code ${row.product_code}: ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }

  await db.updateTable('product_import_runs').set({
    status: summary.errors ? 'completed_with_errors' : 'completed',
    total_records: summary.total,
    created_count: summary.created,
    updated_count: summary.updated + summary.priceUpdated,
    skipped_count: summary.lockedSkipped + summary.unchanged,
    error_count: summary.errors,
    errors: JSON.stringify(summary.problems.slice(0, 200)),
    finished_at: new Date().toISOString(),
  }).where('id', '=', importRunId).execute();

  return summary;
}
