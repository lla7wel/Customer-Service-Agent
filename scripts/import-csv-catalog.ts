/**
 * IMPORT THE CSV CATALOG  — the main priced product catalog for English Home Libya.
 *
 * catalog.csv is the business catalog: customer/admin-facing names (English),
 * Arabic/English keywords, search text, barcodes and prices in L.D. This script
 * makes the database reflect that catalog:
 *
 *   1. Normalizes every existing product_code to canonical form (strips leading
 *      zeros) so scraped products (e.g. 000000010001821004) share identity with
 *      CSV products (10001821004).
 *   2. For each CSV row, matched to an existing product by canonical code (then
 *      barcode): UPDATE it into an active, priced, CSV-backed catalog product —
 *      keeping any scraped images already attached. The Turkish scraped name is
 *      preserved only as source_name (reference).
 *   3. CSV rows with no existing match are INSERTED as active, priced products
 *      with NO images yet (they show as "missing images" in the app).
 *   4. Scraped-only products that are not in the CSV are left untouched in the
 *      review/staging flow (draft, no price).
 *
 * SOURCE OF TRUTH: after this import, the admin database is the source of truth.
 *   - Prices are set ONLY where base_price is currently null → an admin-edited
 *     price is never overwritten, so this is safe to re-run as recovery/setup.
 *   - A CSV row without a price is imported but kept in review (draft, no price).
 *
 * Run (dry):  npm run catalog:csv -- --dry
 * Run:        npm run catalog:csv
 * Needs: DATABASE_URL in EH-SYSTEM1/.env
 */
import { requireDb, type DB } from '../integrations/db/client';
import type { Kysely } from 'kysely';
import { stripLockedFields } from '../integrations/product-locks';
import { readCatalogCsv, normalizeCode, catalogCsvPath, type CatalogRow } from './_lib';

const DRY = process.argv.includes('--dry') || process.argv.includes('--dry-run');
const CHUNK = 40;

interface DbProduct {
  id: string;
  product_code: string;
  barcode: string | null;
  base_price: number | null;
  english_name: string | null;
  arabic_name: string | null;
  search_keywords: string[] | null;
  arabic_keywords: string[] | null;
  source: string | null;
  admin_locked_fields: Record<string, boolean> | null;
}

async function loadAll(db: Kysely<DB>): Promise<DbProduct[]> {
  return (await db
    .selectFrom('products')
    .select(['id', 'product_code', 'barcode', 'base_price', 'english_name', 'arabic_name', 'search_keywords', 'arabic_keywords', 'source', 'admin_locked_fields'])
    .execute()) as unknown as DbProduct[];
}

async function runChunked<T>(items: T[], fn: (item: T) => Promise<boolean>): Promise<{ ok: number; fail: number }> {
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const results = await Promise.allSettled(items.slice(i, i + CHUNK).map(fn));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) ok++;
      else fail++;
    }
    if ((i / CHUNK) % 10 === 0 && i > 0) console.log(`   …${ok + fail}/${items.length}`);
  }
  return { ok, fail };
}

async function main() {
  console.log('EH-SYSTEM — import CSV catalog → database (main priced catalog)\n');
  console.log('Source:', catalogCsvPath());
  if (DRY) console.log('** DRY RUN — no writes **');
  console.log('');

  const db = requireDb();
  const csv = readCatalogCsv();
  console.log(`CSV rows: ${csv.length} (${csv.filter((r) => r.price != null).length} with a price)\n`);

  let existing = await loadAll(db);
  console.log(`Existing products in DB: ${existing.length}`);

  // 1) Normalize existing product_code → canonical (strip leading zeros).
  const needNorm = existing.filter((p) => p.product_code !== normalizeCode(p.product_code));
  console.log(`Codes needing normalization: ${needNorm.length}`);
  if (!DRY && needNorm.length) {
    const res = await runChunked(needNorm, async (p) => {
      await db.updateTable('products').set({ product_code: normalizeCode(p.product_code) }).where('id', '=', p.id).execute();
      return true;
    });
    console.log(`   normalized: ${res.ok}, failed: ${res.fail}`);
    existing = await loadAll(db); // reload with canonical codes
  } else {
    existing.forEach((p) => (p.product_code = normalizeCode(p.product_code)));
  }

  // Build lookup maps (canonical code + barcode).
  const byCode = new Map<string, DbProduct>();
  const byBarcode = new Map<string, DbProduct>();
  for (const p of existing) {
    byCode.set(p.product_code, p);
    if (p.barcode) byBarcode.set(p.barcode, p);
  }

  // 2) Plan inserts vs updates.
  interface Upd { id: string; update: Record<string, unknown>; }
  const inserts: Record<string, unknown>[] = [];
  const updates: Upd[] = [];
  let matchedCode = 0;
  let matchedBarcode = 0;
  const usedIds = new Set<string>();

  for (const row of csv) {
    const code = normalizeCode(row.product_code);
    let match = byCode.get(code);
    if (match) matchedCode++;
    else if (row.barcode && byBarcode.has(row.barcode)) {
      match = byBarcode.get(row.barcode);
      matchedBarcode++;
    }

    const hasName = !!row.product_name;
    const canActivate = row.price != null && hasName;

    if (match && !usedIds.has(match.id)) {
      usedIds.add(match.id);
      const update: Record<string, unknown> = {
        product_code: code, // keep the CSV (canonical) code
        source: 'csv',
        barcode: match.barcode || row.barcode || null,
      };
      // Customer/admin-facing English name from CSV (never clobber admin edits).
      if (!match.english_name && row.product_name) update.english_name = row.product_name;
      if ((!match.search_keywords || match.search_keywords.length === 0) && row.english_keywords.length) update.search_keywords = row.english_keywords;
      if ((!match.arabic_keywords || match.arabic_keywords.length === 0) && row.arabic_keywords.length) update.arabic_keywords = row.arabic_keywords;
      if (row.website_url) update.website_url = row.website_url;
      // Price ONLY if not already set (protects admin-edited prices).
      if (match.base_price == null && row.price != null) {
        update.base_price = row.price;
        update.active_price = row.price;
      }
      // Activate only if it will have a price AND a customer-facing name.
      const willHaveName = match.english_name || match.arabic_name || row.product_name;
      const willHavePrice = match.base_price != null || row.price != null;
      if (willHaveName && willHavePrice) update.status = 'active';
      // Admin edits win forever: drop any field the admin has locked.
      const safe = stripLockedFields(match.admin_locked_fields, update);
      if (Object.keys(safe).length > 0) updates.push({ id: match.id, update: safe });
    } else if (!match) {
      // CSV-only product → insert (no images yet → "missing images").
      inserts.push({
        product_code: code,
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
        raw: JSON.stringify({ csv: row }),
      });
    }
  }

  console.log('\nPlan:');
  console.log(`  CSV matched to existing (by code):    ${matchedCode}`);
  console.log(`  CSV matched to existing (by barcode): ${matchedBarcode}`);
  console.log(`  → updates (activate/price/enrich):    ${updates.length}`);
  console.log(`  → inserts (CSV-only, no images yet):  ${inserts.length}`);

  if (DRY) {
    console.log('\nDry run complete. No data written.');
    console.log('Sample insert:', JSON.stringify(inserts[0]));
    console.log('Sample update:', JSON.stringify(updates[0]));
    return;
  }

  // 3) Apply updates.
  console.log('\nApplying updates…');
  const uRes = await runChunked(updates, async (u) => {
    await db.updateTable('products').set(u.update as any).where('id', '=', u.id).execute();
    return true;
  });
  console.log(`   updated: ${uRes.ok}, failed: ${uRes.fail}`);

  // 4) Apply inserts in bulk batches.
  console.log('Inserting CSV-only products…');
  let inserted = 0;
  let insFailed = 0;
  for (let i = 0; i < inserts.length; i += 500) {
    const batch = inserts.slice(i, i + 500);
    try {
      await db.insertInto('products').values(batch as any[]).execute();
      inserted += batch.length;
    } catch (e: any) {
      insFailed += batch.length;
      console.warn(`   batch ${i}-${i + batch.length} failed: ${e?.message}`);
    }
  }
  console.log(`   inserted: ${inserted}, failed: ${insFailed}`);

  // Audit.
  await db.insertInto('product_import_runs').values({
    source: 'csv',
    source_file: 'catalog.csv',
    status: uRes.fail + insFailed ? 'completed_with_errors' : 'completed',
    total_records: csv.length,
    created_count: inserted,
    updated_count: uRes.ok,
    error_count: uRes.fail + insFailed,
    finished_at: new Date().toISOString(),
  }).execute();
  await db.insertInto('activity_logs').values({
    actor_type: 'system',
    action: 'csv_catalog_import',
    entity_type: 'product',
    summary: `CSV catalog import: ${inserted} inserted, ${uRes.ok} updated/activated.`,
  }).execute();

  console.log('\nDone. The database now reflects the CSV catalog as the priced source of truth.');
  console.log('Scraped-only products remain in review/staging until an admin completes them.');
}

main().catch((e) => {
  console.error('\n✗ CSV catalog import failed:', e.message);
  process.exit(1);
});
