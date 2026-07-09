/**
 * One-command catalog enrichment (Priority 2). Runs the full scraper→Supabase
 * pipeline in the correct order, with logging + per-step pass/fail reporting.
 * Repeatable and resumable: each step is idempotent and admin-edited fields are
 * never overwritten (see integrations/product-locks.ts).
 *
 * Steps (in order):
 *   1. validate        — sanity-check the scraper output (always read-only)
 *   2. import:products — upsert scraped products + reference metadata + images
 *   3. catalog:csv     — apply the CSV catalog (customer-facing truth, respects locks)
 *   4. upload:images   — push local images to Supabase Storage (storage_path/public_url)
 *   5. fingerprints    — compute dHash perceptual hashes for image matching
 *   6. match:images    — refresh scraper↔CSV match SUGGESTIONS (admin reviews in Catalog Review)
 *
 * Run:    npm run enrich
 * Dry:    DRY=1 npm run enrich         (passes DRY through; no writes where supported)
 * Stop:   STOP_ON_ERROR=1 npm run enrich   (halt at first failing step)
 *
 * NOTE: this is a LOCAL/server job — it reads the scraper's local image files, so
 * it can't run on Vercel serverless. Schedule it via cron on the machine that has
 * the scraper output, or run it after each scrape.
 */
import { spawnSync } from 'node:child_process';

const DRY = process.env.DRY === '1' || process.env.DRY === 'true';
const STOP_ON_ERROR = process.env.STOP_ON_ERROR === '1' || process.env.STOP_ON_ERROR === 'true';

interface Step { name: string; script: string; args?: string[]; supportsDry: boolean }

const STEPS: Step[] = [
  { name: 'validate', script: 'validate-import.ts', supportsDry: true },           // always read-only
  { name: 'import:products', script: 'import-scraper-products.ts', supportsDry: false },
  { name: 'catalog:csv', script: 'import-csv-catalog.ts', supportsDry: false },
  { name: 'upload:images', script: 'upload-product-images.ts', supportsDry: false },
  { name: 'fingerprints', script: 'generate-image-fingerprints.ts', supportsDry: true },
  { name: 'match:images', script: 'catalog-image-match.ts', supportsDry: true },
];

function run() {
  console.log(`\n=== Catalog enrichment ${DRY ? '(DRY RUN)' : ''} ===\n`);
  const results: { step: string; ok: boolean; skipped?: boolean; code: number | null }[] = [];
  const startedAt = Date.now();

  for (const step of STEPS) {
    // In DRY mode, only run steps that genuinely support a no-write mode.
    if (DRY && !step.supportsDry) {
      console.log(`— skip ${step.name} (no dry-run support)\n`);
      results.push({ step: step.name, ok: true, skipped: true, code: null });
      continue;
    }
    console.log(`▶ ${step.name} …`);
    const env = { ...process.env };
    if (DRY && step.supportsDry) env.DRY = '1';
    const r = spawnSync('npx', ['tsx', step.script, ...(step.args ?? [])], { stdio: 'inherit', env });
    const ok = r.status === 0;
    results.push({ step: step.name, ok, code: r.status });
    console.log(ok ? `✓ ${step.name}\n` : `✗ ${step.name} (exit ${r.status})\n`);
    if (!ok && STOP_ON_ERROR) { console.error('Halting (STOP_ON_ERROR).'); break; }
  }

  const failed = results.filter((r) => !r.ok);
  console.log('=== Summary ===');
  for (const r of results) console.log(`  ${r.skipped ? '–' : r.ok ? '✓' : '✗'} ${r.step}${r.skipped ? ' (skipped)' : ''}`);
  console.log(`Took ${Math.round((Date.now() - startedAt) / 1000)}s · ${failed.length} failed`);
  if (failed.length) process.exitCode = 1;
}

run();
