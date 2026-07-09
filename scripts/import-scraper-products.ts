/**
 * Import the scraper's products into the database (upsert by product_code) and
 * create product_images rows from the local image references. READ-ONLY on the
 * scraper — it only reads products-with-images.json and the image file paths.
 *
 * Run:  npm run import:products
 * Needs: DATABASE_URL in EH-SYSTEM1/.env
 */
import { requireDb } from '../integrations/db/client';
import { readScraperProducts, mapNewProductRow, mapSourceMetadata, normalizeCode, type ScraperProduct } from './_lib';

async function main() {
  console.log('EH-SYSTEM — import scraper products → database\n');
  const db = requireDb(); // throws a clear message if env is missing
  const products = readScraperProducts();
  console.log(`Read ${products.length} products from the scraper output.\n`);

  // Open an import run for auditing.
  const run = await db
    .insertInto('product_import_runs')
    .values({ source: 'scraper', source_file: 'products-with-images.json', status: 'running', total_records: products.length })
    .returning('id')
    .executeTakeFirstOrThrow();
  const runId = run.id;

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let imagesInserted = 0;
  const errors: { product_code?: string; error: string }[] = [];

  for (const p of products as ScraperProduct[]) {
    if (!p.product_code) {
      skipped++;
      continue;
    }
    try {
      // Match by canonical (normalized) code so the scraper attaches to the
      // existing CSV/Supabase product instead of creating a duplicate.
      const code = normalizeCode(p.product_code);
      const existing = await db.selectFrom('products').select('id').where('product_code', '=', code).executeTakeFirst();

      let productId: string;
      if (existing) {
        // EXISTING: refresh SOURCE/reference metadata + images ONLY. Never touch
        // price, status, source flag, name, barcode or category — the admin app /
        // CSV catalog own those (source-of-truth rule).
        await db
          .updateTable('products')
          .set(mapSourceMetadata(p, runId) as any)
          .where('id', '=', existing.id)
          .execute();
        productId = existing.id;
        updated++;
      } else {
        // NEW scraped-only: insert as 'draft' (needs review), no price set.
        const prod = await db
          .insertInto('products')
          .values(mapNewProductRow(p, runId) as any)
          .returning('id')
          .executeTakeFirstOrThrow();
        productId = prod.id;
        created++;
      }

      // Images: only insert if this product has none yet (idempotent-ish).
      const countRow = await db
        .selectFrom('product_images')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('product_id', '=', productId)
        .executeTakeFirst();
      if (Number(countRow?.n ?? 0) === 0 && p.images?.length) {
        const rows = p.images.map((rel, i) => ({
          product_id: productId,
          local_path: rel,
          position: i,
          is_primary: i === 0,
        }));
        await db.insertInto('product_images').values(rows).execute();
        imagesInserted += rows.length;

        // Point products.primary_image_id at the first image.
        const primary = await db
          .selectFrom('product_images')
          .select('id')
          .where('product_id', '=', productId)
          .where('position', '=', 0)
          .executeTakeFirst();
        if (primary) await db.updateTable('products').set({ primary_image_id: primary.id }).where('id', '=', productId).execute();
      }
    } catch (e: any) {
      errors.push({ product_code: p.product_code, error: e?.message ?? 'unknown' });
    }
  }

  await db
    .updateTable('product_import_runs')
    .set({
      status: errors.length ? 'completed_with_errors' : 'completed',
      created_count: created,
      updated_count: updated,
      skipped_count: skipped,
      error_count: errors.length,
      errors: JSON.stringify(errors.slice(0, 100)),
      finished_at: new Date().toISOString(),
    })
    .where('id', '=', runId)
    .execute();

  console.log('Done.');
  console.log(`  created:         ${created}`);
  console.log(`  updated:         ${updated}`);
  console.log(`  skipped(no code):${skipped}`);
  console.log(`  images inserted: ${imagesInserted}`);
  console.log(`  errors:          ${errors.length}`);
  if (errors.length) {
    console.log('\nFirst errors:');
    errors.slice(0, 5).forEach((e) => console.log(`   - ${e.product_code}: ${e.error}`));
  }
  console.log('\nNext: npm run upload:images  (copy local images into MEDIA_ROOT)');
}

main().catch((e) => {
  console.error('\n✗ Import failed:', e.message);
  process.exit(1);
});
