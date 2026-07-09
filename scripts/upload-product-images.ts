/**
 * Copy local scraper images into media storage (MEDIA_ROOT, served by the
 * reverse proxy) and fill in product_images.storage_path + public_url.
 * READ-ONLY on the scraper (reads the image files; never modifies them).
 *
 * Definitions (strict):
 *   - fully uploaded = storage_path IS NOT NULL AND public_url IS NOT NULL
 *   - pending        = storage_path IS NULL  OR  public_url IS NULL
 *
 * Behavior per pending row:
 *   - storage_path set but public_url null → backfill public_url (no re-copy)
 *   - storage_path null                    → copy the local file, then set both
 *
 * Resumable + safe to rerun: copies overwrite the same object path (no
 * duplicates), DB updates are by row id. Re-running picks up whatever is
 * still pending — including rows that were skipped/failed in a previous run.
 *
 * Run:   npm run upload:images
 * Limit: LIMIT=2000 npm run upload:images   (process at most N pending rows)
 * Tune:  CONCURRENCY=12 npm run upload:images
 * Needs: DATABASE_URL + MEDIA_ROOT + PUBLIC_MEDIA_BASE_URL in EH-SYSTEM1/.env
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Kysely } from 'kysely';
import { requireDb, type DB } from '../integrations/db/client';
import { putObject, publicUrl, isStorageConfigured } from '../integrations/storage';
import { resolveImageAbsPath, fileExists } from './_lib';

const CONCURRENCY = process.env.CONCURRENCY ? Math.max(1, parseInt(process.env.CONCURRENCY, 10)) : 10;
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
const FETCH_BATCH = 500;

interface ImgRow {
  id: string;
  local_path: string | null;
  storage_path: string | null;
  public_url: string | null;
  position: number;
  product_id: string;
}

type Pending = 'pending' | 'uploaded' | 'all';

async function countRows(db: Kysely<DB>, which: Pending): Promise<number> {
  let q = db.selectFrom('product_images').select((eb) => eb.fn.countAll().as('n'));
  if (which === 'pending') q = q.where((eb) => eb.or([eb('storage_path', 'is', null), eb('public_url', 'is', null)]));
  if (which === 'uploaded') q = q.where('storage_path', 'is not', null).where('public_url', 'is not', null);
  const row = await q.executeTakeFirst();
  return Number(row?.n ?? 0);
}

/** Run async fn over items with a fixed concurrency pool. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx]);
      }
    }),
  );
}

async function main() {
  console.log('EH-SYSTEM — copy product images → media storage\n');
  const db = requireDb();
  if (!isStorageConfigured()) {
    throw new Error('Media storage is not configured. Set MEDIA_ROOT and PUBLIC_MEDIA_BASE_URL.');
  }

  const totalRows = await countRows(db, 'all');
  const alreadyUploaded = await countRows(db, 'uploaded');
  const pendingBefore = await countRows(db, 'pending');

  console.log(`total rows:       ${totalRows}`);
  console.log(`already uploaded: ${alreadyUploaded}  (storage_path AND public_url)`);
  console.log(`pending:          ${pendingBefore}  (storage_path OR public_url is null)`);
  console.log(`concurrency:      ${CONCURRENCY}${Number.isFinite(LIMIT) ? `  ·  limit: ${LIMIT}` : ''}\n`);

  if (pendingBefore === 0) {
    console.log('Nothing pending — every image row is fully uploaded.');
    return;
  }

  // Counters.
  let uploaded = 0;
  let backfilled = 0;
  let skippedMissingLocal = 0;
  let failed = 0;
  let processed = 0;
  const errors: string[] = [];

  // Keyset pagination by id (ascending). Rows that succeed leave the pending set;
  // rows that fail/skip stay pending but the cursor moves past them, so this run
  // won't loop forever. A later rerun retries them from the start.
  let cursor = '';
  const codeCache = new Map<string, string>();

  outer: for (;;) {
    if (processed >= LIMIT) break;

    let q = db
      .selectFrom('product_images')
      .select(['id', 'local_path', 'storage_path', 'public_url', 'position', 'product_id'])
      .where((eb) => eb.or([eb('storage_path', 'is', null), eb('public_url', 'is', null)]));
    if (cursor) q = q.where('id', '>', cursor);
    const rows = (await q.orderBy('id', 'asc').limit(FETCH_BATCH).execute()) as ImgRow[];
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    // Respect LIMIT across batches.
    const slice = Number.isFinite(LIMIT) ? rows.slice(0, LIMIT - processed) : rows;

    // Pre-fetch product_codes for upload-needed rows in this batch.
    const needCodes = [...new Set(slice.filter((r) => !r.storage_path).map((r) => r.product_id))].filter(
      (id) => !codeCache.has(id),
    );
    if (needCodes.length) {
      const prods = await db.selectFrom('products').select(['id', 'product_code']).where('id', 'in', needCodes).execute();
      for (const p of prods) codeCache.set(p.id, p.product_code);
    }

    await pool(slice, CONCURRENCY, async (img) => {
      try {
        if (img.storage_path) {
          // Already in storage — just backfill the public_url.
          const url = publicUrl(img.storage_path);
          if (!url) throw new Error('PUBLIC_MEDIA_BASE_URL not set');
          await db.updateTable('product_images').set({ public_url: url }).where('id', '=', img.id).execute();
          backfilled++;
          return;
        }

        // Needs upload: resolve the local file.
        if (!img.local_path) {
          skippedMissingLocal++;
          return;
        }
        const abs = resolveImageAbsPath(img.local_path);
        if (!fileExists(abs)) {
          skippedMissingLocal++;
          return;
        }
        const code = codeCache.get(img.product_id) || img.product_id;
        const ext = path.extname(abs).toLowerCase();
        const objectPath = `products/${code}/${String(img.position).padStart(2, '0')}${ext || '.jpg'}`;
        const bytes = fs.readFileSync(abs);
        const put = await putObject(objectPath, bytes);
        if (!put.ok) throw new Error(put.reason);
        await db
          .updateTable('product_images')
          .set({ storage_path: put.data.path, public_url: put.data.publicUrl })
          .where('id', '=', img.id)
          .execute();
        uploaded++;
      } catch (e: any) {
        failed++;
        if (errors.length < 5) errors.push(`${img.id}: ${e?.message ?? 'unknown'}`);
      } finally {
        processed++;
      }
    });

    const done = uploaded + backfilled + skippedMissingLocal + failed;
    console.log(`  …processed ${done} (uploaded ${uploaded}, backfilled ${backfilled}, skipped ${skippedMissingLocal}, failed ${failed})`);
    if (Number.isFinite(LIMIT) && processed >= LIMIT) break outer;
  }

  const remainingPending = await countRows(db, 'pending');

  console.log('\nSummary');
  console.log(`  total_rows:               ${totalRows}`);
  console.log(`  already_uploaded:         ${alreadyUploaded}`);
  console.log(`  pending_before:           ${pendingBefore}`);
  console.log(`  uploaded_this_run:        ${uploaded}`);
  console.log(`  public_urls_backfilled:   ${backfilled}`);
  console.log(`  skipped_missing_local:    ${skippedMissingLocal}`);
  console.log(`  failed:                   ${failed}`);
  console.log(`  remaining_pending:        ${remainingPending}`);
  if (errors.length) {
    console.log('\n  sample errors:');
    errors.forEach((e) => console.log(`    - ${e}`));
  }
  if (remainingPending > 0) {
    console.log(`\n${remainingPending} rows still pending. Rerun to continue:`);
    console.log('  cd EH-SYSTEM1/scripts && npm run upload:images');
  } else {
    console.log('\n✓ All image rows are fully uploaded (storage_path AND public_url).');
  }
}

main().catch((e) => {
  console.error('\n✗ Upload failed:', e.message);
  process.exit(1);
});
