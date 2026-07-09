/**
 * Dry-run validator. Reads the scraper output and reports exactly what WOULD be
 * imported. Writes NOTHING (neither to the scraper nor to Supabase). Safe to run
 * anytime. Exit code is non-zero if the output is missing/invalid.
 */
import { readScraperProducts, productsJsonPath, resolveImageAbsPath, fileExists } from './_lib';

function main() {
  console.log('EH-SYSTEM1 — validate scraper import (dry run, no writes)\n');
  console.log('Source:', productsJsonPath(), '\n');

  let products;
  try {
    products = readScraperProducts();
  } catch (e: any) {
    console.error('✗', e.message);
    process.exit(1);
  }

  let withCode = 0;
  let withBarcode = 0;
  let totalImages = 0;
  let missingImageFiles = 0;
  const dupes = new Map<string, number>();
  const noCode: string[] = [];

  for (const p of products) {
    if (p.product_code) {
      withCode++;
      dupes.set(p.product_code, (dupes.get(p.product_code) ?? 0) + 1);
    } else {
      noCode.push(p.product_name || '(unnamed)');
    }
    if (p.barcode) withBarcode++;
    const imgs = p.images ?? [];
    totalImages += imgs.length;
    // Spot-check the first image of each product exists on disk.
    if (imgs[0] && !fileExists(resolveImageAbsPath(imgs[0]))) missingImageFiles++;
  }

  const duplicateCodes = [...dupes.entries()].filter(([, n]) => n > 1);

  console.log(`Products in file:        ${products.length}`);
  console.log(`  with product_code:     ${withCode}`);
  console.log(`  with barcode:          ${withBarcode}`);
  console.log(`  missing product_code:  ${noCode.length}`);
  console.log(`Total image references:  ${totalImages}`);
  console.log(`Products whose 1st image file is missing on disk: ${missingImageFiles}`);
  console.log(`Duplicate product_codes: ${duplicateCodes.length}`);

  if (noCode.length) {
    console.log('\n⚠ Products without a code (skipped on import):');
    noCode.slice(0, 10).forEach((n) => console.log('   -', n));
    if (noCode.length > 10) console.log(`   …and ${noCode.length - 10} more`);
  }
  if (duplicateCodes.length) {
    console.log('\n⚠ Duplicate codes (last one wins on upsert):');
    duplicateCodes.slice(0, 10).forEach(([c, n]) => console.log(`   - ${c} ×${n}`));
  }

  console.log('\nNext steps:');
  console.log('  npm run import:products   # upsert products + product_images rows');
  console.log('  npm run upload:images     # upload local images to Supabase Storage');
  console.log('\n✓ Validation complete. No data was written.');
}

main();
