/**
 * Generate / refresh perceptual-hash (dHash) fingerprints for product images.
 * These power the runtime image matcher (compare a customer photo's dHash to the
 * catalog by Hamming distance). READ-ONLY on the scraper; only writes
 * product_images.perceptual_hash.
 *
 * Pending = perceptual_hash IS NULL. Source bytes: public_url (preferred) else the
 * local scraper file. Resumable + safe to rerun.
 *
 * Run:    npm run fingerprints
 * Dry:    DRY=1 npm run fingerprints           (report only, no writes)
 * Force:  FORCE=1 npm run fingerprints         (recompute even if already set)
 * Limit:  LIMIT=2000 npm run fingerprints
 * Tune:   CONCURRENCY=8 npm run fingerprints
 * Needs:  SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */
import './_env';
import fs from 'node:fs';
import { requireAdminClient } from '../integrations/supabase/admin-client';
import { dhashFromBytes } from '../integrations/util/image-hash';
import { resolveImageAbsPath, fileExists } from './_lib';

const FETCH_BATCH = 500;
const CONCURRENCY = process.env.CONCURRENCY ? Math.max(1, parseInt(process.env.CONCURRENCY, 10)) : 8;
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
const DRY = process.env.DRY === '1' || process.env.DRY === 'true';
const FORCE = process.env.FORCE === '1' || process.env.FORCE === 'true';

interface ImgRow { id: string; public_url: string | null; local_path: string | null; perceptual_hash: string | null }

async function loadBytes(row: ImgRow): Promise<Buffer | null> {
  if (row.public_url) {
    try {
      const res = await fetch(row.public_url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch { /* fall through to local */ }
  }
  if (row.local_path) {
    const abs = resolveImageAbsPath(row.local_path);
    if (fileExists(abs)) { try { return fs.readFileSync(abs); } catch { /* ignore */ } }
  }
  return null;
}

async function run() {
  const db = requireAdminClient();
  const stats = { scanned: 0, hashed: 0, skippedNoBytes: 0, failed: 0, alreadyHad: 0 };
  let processed = 0;
  let from = 0;

  for (;;) {
    if (processed >= LIMIT) break;
    let q = db.from('product_images').select('id, public_url, local_path, perceptual_hash');
    if (!FORCE) q = q.is('perceptual_hash', null);
    const { data, error } = await q.range(from, from + FETCH_BATCH - 1);
    if (error) { console.error('query error:', error.message); process.exitCode = 1; break; }
    const rows = (data ?? []) as ImgRow[];
    if (rows.length === 0) break;
    // Same pagination correctness fix as the embeddings script: hashed rows leave
    // the `perceptual_hash IS NULL` filter, so only advance the offset past rows
    // that stayed pending (no-bytes/failed), else we skip half the images.
    const stuckBefore = stats.skippedNoBytes + stats.failed;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      if (processed >= LIMIT) break;
      const slice = rows.slice(i, i + CONCURRENCY).slice(0, Math.max(0, LIMIT - processed));
      await Promise.all(slice.map(async (row) => {
        stats.scanned++;
        processed++;
        if (row.perceptual_hash && !FORCE) { stats.alreadyHad++; return; }
        const bytes = await loadBytes(row);
        if (!bytes) { stats.skippedNoBytes++; return; }
        const hash = await dhashFromBytes(bytes);
        if (!hash) { stats.failed++; return; }
        if (DRY) { stats.hashed++; return; }
        const { error: upErr } = await db.from('product_images').update({ perceptual_hash: hash }).eq('id', row.id);
        if (upErr) { stats.failed++; return; }
        stats.hashed++;
      }));
      process.stdout.write(`\r  processed ${processed} · hashed ${stats.hashed} · no-bytes ${stats.skippedNoBytes} · failed ${stats.failed}   `);
    }
    const stuck = (stats.skippedNoBytes + stats.failed) - stuckBefore;
    if (FORCE) {
      from += rows.length;
      if (rows.length < FETCH_BATCH) break;
    } else {
      from += stuck;
    }
  }

  console.log('\n' + JSON.stringify({ mode: DRY ? 'dry-run' : 'apply', force: FORCE, ...stats }, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
