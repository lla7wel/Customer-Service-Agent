/**
 * Generate / refresh REAL semantic embeddings for products (products.text_embedding).
 * These power the runtime vector search (semantic catalog lookup that handles
 * synonyms / loose Arabic & English wording). Uses the real Gemini embedding
 * model — NEVER fakes a vector. READ-ONLY on the scraper; only writes
 * products.text_embedding.
 *
 * Pending = text_embedding IS NULL AND status = 'active'. Resumable + safe to rerun.
 *
 * Run:    npm run embeddings              (or: npx tsx scripts/generate-embeddings.ts)
 * Dry:    DRY=1 npm run embeddings        (report only, no writes)
 * Force:  FORCE=1 npm run embeddings      (recompute even if already set)
 * Limit:  LIMIT=2000 npm run embeddings
 * Needs:  DATABASE_URL + GEMINI_API_KEY
 */
import './_env';
import { requireDb } from '../integrations/db/client';
import { embedText, isGeminiConfigured } from '../integrations/gemini/client';

const FETCH_BATCH = 200;
const CONCURRENCY = process.env.CONCURRENCY ? Math.max(1, parseInt(process.env.CONCURRENCY, 10)) : 8;
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
const DRY = process.env.DRY === '1' || process.env.DRY === 'true';
const FORCE = process.env.FORCE === '1' || process.env.FORCE === 'true';

interface Row {
  id: string;
  libyan_display_name: string | null;
  arabic_name: string | null;
  english_name: string | null;
  source_name: string | null;
  category: string | null;
  search_keywords: string[] | null;
  arabic_keywords: string[] | null;
  text_embedding: unknown;
}

/** The text we embed for a product: every name + keywords (catalog-safe). */
function embeddingText(r: Row): string {
  return [
    r.libyan_display_name, r.arabic_name, r.english_name, r.source_name, r.category,
    ...(r.search_keywords ?? []), ...(r.arabic_keywords ?? []),
  ].filter(Boolean).join(' ').trim();
}

async function run() {
  if (!isGeminiConfigured()) {
    console.error('GEMINI_API_KEY is required to generate real embeddings. Aborting (no fake vectors written).');
    process.exit(1);
  }
  const db = requireDb();
  const stats = { scanned: 0, embedded: 0, skippedEmpty: 0, failed: 0, alreadyHad: 0 };
  let processed = 0;
  let from = 0;

  for (;;) {
    if (processed >= LIMIT) break;
    let q = db.selectFrom('products')
      .select(['id', 'libyan_display_name', 'arabic_name', 'english_name', 'source_name', 'category', 'search_keywords', 'arabic_keywords', 'text_embedding'])
      .where('status', '=', 'active');
    if (!FORCE) q = q.where('text_embedding', 'is', null);
    let rows: Row[];
    try {
      rows = (await q.orderBy('id', 'asc').limit(FETCH_BATCH).offset(from).execute()) as Row[];
    } catch (e: any) { console.error('query error:', e?.message); process.exitCode = 1; break; }
    if (rows.length === 0) break;
    // Pagination correctness: in non-FORCE mode, embedded rows DROP OUT of the
    // `text_embedding IS NULL` filter, so the result set shifts under us. We must
    // only step the offset past rows that STAYED pending (skipped/failed),
    // otherwise we skip half the catalog (the original backfill bug). In FORCE
    // mode the set is stable, so advance normally.
    const stuckBefore = stats.skippedEmpty + stats.failed;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      if (processed >= LIMIT) break;
      const slice = rows.slice(i, i + CONCURRENCY).slice(0, Math.max(0, LIMIT - processed));
      await Promise.all(slice.map(async (row) => {
        stats.scanned++;
        processed++;
        if (row.text_embedding && !FORCE) { stats.alreadyHad++; return; }
        const text = embeddingText(row);
        if (!text) { stats.skippedEmpty++; return; }
        const emb = await embedText(text, 'RETRIEVAL_DOCUMENT');
        if (!emb.values) { stats.failed++; return; }
        if (DRY) { stats.embedded++; return; }
        try {
          await db.updateTable('products').set({ text_embedding: JSON.stringify(emb.values) }).where('id', '=', row.id).execute();
        } catch { stats.failed++; return; }
        stats.embedded++;
      }));
      process.stdout.write(`\r  processed ${processed} · embedded ${stats.embedded} · empty ${stats.skippedEmpty} · failed ${stats.failed}   `);
      await new Promise((r) => setTimeout(r, 50)); // gentle rate limit
    }
    const stuck = (stats.skippedEmpty + stats.failed) - stuckBefore;
    if (FORCE) {
      from += rows.length;
      if (rows.length < FETCH_BATCH) break;
    } else {
      // Embedded rows left the filter; step over only the ones that stayed null.
      from += stuck;
    }
  }

  console.log('\n' + JSON.stringify({ mode: DRY ? 'dry-run' : 'apply', force: FORCE, ...stats }, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
