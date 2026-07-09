/**
 * Import the scraper's products into Supabase (upsert by product_code) and
 * create product_images rows from the local image references. READ-ONLY on the
 * scraper — it only reads products-with-images.json and the image file paths.
 *
 * Run:  npm run import:products
 * Needs: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in EH-SYSTEM1/.env
 */
import { requireAdminClient } from '../integrations/supabase/admin-client';
import { readScraperProducts, mapNewProductRow, mapSourceMetadata, normalizeCode, type ScraperProduct } from './_lib';

async function main() {
  console.log('EH-SYSTEM1 — import scraper products → Supabase\n');
  const db = requireAdminClient(); // throws a clear message if env is missing
  const products = readScraperProducts();
  console.log(`Read ${products.length} products from the scraper output.\n`);

  // Open an import run for auditing.
  const { data: run, error: runErr } = await db
    .from('product_import_runs')
    .insert({ source: 'scraper', source_file: 'products-with-images.json', status: 'running', total_records: products.length })
    .select('id')
    .single();
  if (runErr) throw new Error(`Could not create import run: ${runErr.message}`);
  const runId = run.id as string;

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
      const { data: existing } = await db.from('products').select('id').eq('product_code', code).maybeSingle();

      let productId: string;
      if (existing) {
        // EXISTING: refresh SOURCE/reference metadata + images ONLY. Never touch
        // price, status, source flag, name, barcode or category — the admin app /
        // CSV catalog own those (source-of-truth rule).
        const { error: upErr } = await db
          .from('products')
          .update(mapSourceMetadata(p, runId))
          .eq('id', existing.id);
        if (upErr) throw new Error(upErr.message);
        productId = existing.id as string;
        updated++;
      } else {
        // NEW scraped-only: insert as 'draft' (needs review), no price set.
        const { data: prod, error: insErr } = await db
          .from('products')
          .insert(mapNewProductRow(p, runId))
          .select('id')
          .single();
        if (insErr) throw new Error(insErr.message);
        productId = prod.id as string;
        created++;
      }

      // Images: only insert if this product has none yet (idempotent-ish).
      const { count } = await db
        .from('product_images')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', productId);
      if ((count ?? 0) === 0 && p.images?.length) {
        const rows = p.images.map((rel, i) => ({
          product_id: productId,
          local_path: rel,
          position: i,
          is_primary: i === 0,
        }));
        const { error: imgErr } = await db.from('product_images').insert(rows);
        if (imgErr) throw new Error(`images: ${imgErr.message}`);
        imagesInserted += rows.length;

        // Point products.primary_image_id at the first image.
        const { data: primary } = await db
          .from('product_images')
          .select('id')
          .eq('product_id', productId)
          .eq('position', 0)
          .maybeSingle();
        if (primary) await db.from('products').update({ primary_image_id: primary.id }).eq('id', productId);
      }
    } catch (e: any) {
      errors.push({ product_code: p.product_code, error: e?.message ?? 'unknown' });
    }
  }

  await db
    .from('product_import_runs')
    .update({
      status: errors.length ? 'completed_with_errors' : 'completed',
      created_count: created,
      updated_count: updated,
      skipped_count: skipped,
      error_count: errors.length,
      errors: errors.slice(0, 100),
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId);

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
  console.log('\nNext: npm run upload:images  (push local images to Supabase Storage)');
}

main().catch((e) => {
  console.error('\n✗ Import failed:', e.message);
  process.exit(1);
});
