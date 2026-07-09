/**
 * Controlled product-lookup tools — the ONLY way the AI brain reaches the
 * catalog. Gemini never runs SQL; it calls these typed functions (directly via
 * function-calling, or the pipeline calls them and feeds it the results).
 *
 * Hard safety enforced here, once, for every caller:
 *   - only status='active' AND active_price IS NOT NULL products are returned,
 *   - the customer-facing name is customerProductName() (never source_name),
 *   - price is active_price (never invented).
 */
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { normalizeCode, normalizeBarcode, tokenize } from '../catalog-match';
import { customerProductName, originalProductName, primaryProductImageUrl } from '../util/product-display';
import { embedText } from '../gemini/client';
import { cosineSimilarity } from './vector-search';
import { PRODUCT_COLUMNS, PRODUCT_IMAGE_COLUMNS, type ProductCandidate, type ToolResult, type RetrievalTrack } from './types';

export function toCandidate(p: any, confidence = 0, reason: string | null = null, tracks: RetrievalTrack[] = []): ProductCandidate {
  return {
    id: p.id,
    product_code: p.product_code ?? null,
    barcode: p.barcode ?? null,
    name: customerProductName(p),
    original_name: originalProductName(p),
    price: p.active_price ?? null,
    image: primaryProductImageUrl(p),
    website_url: p.website_url ?? null,
    confidence,
    reason,
    retrieval_tracks: tracks,
  };
}

/**
 * Base product select: the shared columns plus each product's images embedded
 * as a `product_images` array (same nested shape every tool has always used).
 */
export function productSelect(db: Kysely<DB>) {
  return db
    .selectFrom('products')
    .select(PRODUCT_COLUMNS.map((c) => `products.${c}` as const))
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('product_images')
          .select([...PRODUCT_IMAGE_COLUMNS])
          .whereRef('product_images.product_id', '=', 'products.id')
          .orderBy('position', 'asc'),
      ).as('product_images'),
    ]);
}

/** Only customer-quotable products: active AND priced. */
export function activePriced(q: ReturnType<typeof productSelect>) {
  return q.where('products.status', '=', 'active').where('products.active_price', 'is not', null);
}

/** Exact product-code lookup (deterministic identity). */
export async function findProductByCode(db: Kysely<DB>, code: string): Promise<ToolResult<ProductCandidate | null>> {
  const norm = normalizeCode(code);
  if (!norm) return { ok: true, data: null };
  const data = await activePriced(productSelect(db)).where('products.product_code', '=', code).executeTakeFirst();
  if (data) return { ok: true, data: toCandidate(data, 0.97, 'exact product code', ['exact_code']) };
  // Fallback: normalized compare (handles zero-padding / separators).
  const rows = await activePriced(productSelect(db)).where('products.product_code', 'ilike', `%${norm}%`).limit(10).execute();
  const hit = rows.find((p) => normalizeCode(p.product_code) === norm);
  return { ok: true, data: hit ? toCandidate(hit, 0.97, 'exact product code', ['exact_code']) : null };
}

/** Exact barcode lookup (deterministic identity). */
export async function findProductByBarcode(db: Kysely<DB>, barcode: string): Promise<ToolResult<ProductCandidate | null>> {
  const norm = normalizeBarcode(barcode);
  if (!norm) return { ok: true, data: null };
  const data = await activePriced(productSelect(db)).where('products.barcode', '=', norm).executeTakeFirst();
  if (data) return { ok: true, data: toCandidate(data, 0.97, 'exact barcode', ['exact_barcode']) };
  const byRaw = await activePriced(productSelect(db)).where('products.barcode', '=', barcode).executeTakeFirst();
  return { ok: true, data: byRaw ? toCandidate(byRaw, 0.97, 'exact barcode', ['exact_barcode']) : null };
}

/** Exact website_url lookup, then a query/hash-stripped retry. */
export async function findProductByUrl(db: Kysely<DB>, url: string): Promise<ToolResult<ProductCandidate | null>> {
  const clean = (url ?? '').trim();
  if (!/^https?:\/\//i.test(clean)) return { ok: true, data: null };
  const data = await activePriced(productSelect(db)).where('products.website_url', '=', clean).executeTakeFirst();
  if (data) return { ok: true, data: toCandidate(data, 0.96, 'exact product link', ['exact_url']) };
  // Strip query/hash and retry exact.
  let bare = clean;
  try { const u = new URL(clean); u.search = ''; u.hash = ''; bare = u.toString(); } catch { /* keep clean */ }
  if (bare !== clean) {
    const d2 = await activePriced(productSelect(db)).where('products.website_url', '=', bare).executeTakeFirst();
    if (d2) return { ok: true, data: toCandidate(d2, 0.96, 'exact product link', ['exact_url']) };
  }
  return { ok: true, data: null };
}

const TEXT_SEARCH_NAME_COLUMNS = [
  'libyan_display_name', 'arabic_name', 'english_name', 'source_name', 'category',
] as const;

/**
 * Keyword ILIKE search over active+priced products, returning raw rows (with
 * embedded images). Shared by the text tool below and the image-match pipeline,
 * which needs the raw rows for perceptual-hash scoring.
 */
export async function searchProductRows(db: Kysely<DB>, terms: string[], limit: number, maxTerms = 12) {
  const clean = Array.from(new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))).slice(0, maxTerms);
  if (!clean.length) return [];
  return activePriced(productSelect(db))
    .where((eb) =>
      eb.or(
        clean.flatMap((t) =>
          TEXT_SEARCH_NAME_COLUMNS.map((col) => eb(`products.${col}`, 'ilike', `%${t}%`)),
        ),
      ),
    )
    .limit(limit)
    .execute();
}

/** Wide text search across Arabic/English/Turkish names + keyword arrays, scored in code. */
export async function searchProductsByText(db: Kysely<DB>, terms: string[], limit = 20): Promise<ToolResult<ProductCandidate[]>> {
  const clean = Array.from(new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))).slice(0, 12);
  if (!clean.length) return { ok: true, data: [] };
  const rows = await searchProductRows(db, clean, Math.max(limit * 6, 40));
  if (!rows.length) return { ok: true, data: [] };
  const queryTokens = new Set(clean.flatMap((t) => tokenize(t)));
  const scored = rows
    .map((p) => {
      const nameTokens = new Set<string>([
        ...tokenize(p.libyan_display_name), ...tokenize(p.arabic_name), ...tokenize(p.english_name),
        ...tokenize(p.source_name), ...tokenize(p.category),
        ...((p.search_keywords ?? []) as string[]).flatMap((k) => tokenize(k)),
        ...((p.arabic_keywords ?? []) as string[]).flatMap((k) => tokenize(k)),
      ]);
      let overlap = 0;
      for (const t of queryTokens) if (nameTokens.has(t)) overlap++;
      if (primaryProductImageUrl(p)) overlap += 0.25;
      return { p, s: overlap };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
  const maxS = scored[0]?.s || 1;
  return {
    ok: true,
    data: scored.map(({ p, s }) => toCandidate(p, Math.max(0.2, Math.min(0.9, s / (maxS + 1))), 'keyword match', ['text_search'])),
  };
}

/**
 * Semantic vector search: embed `query` with the real Gemini embedding model and
 * rank active+priced products that have a stored text_embedding by cosine. Returns
 * [] (never fake results) when embeddings/key are unavailable.
 */
export async function vectorSearchProductText(db: Kysely<DB>, query: string, limit = 10): Promise<ToolResult<ProductCandidate[]>> {
  const emb = await embedText(query, 'RETRIEVAL_QUERY');
  if (!emb.values) return { ok: true, data: [] };
  // Pull candidate embeddings (bounded scan, consistent with the dHash scan).
  const rows = await activePriced(productSelect(db))
    .select('products.text_embedding')
    .where('products.text_embedding', 'is not', null)
    .limit(5000)
    .execute();
  if (!rows.length) return { ok: true, data: [] };
  const scored = rows
    .map((p) => {
      const vec = Array.isArray(p.text_embedding) ? (p.text_embedding as number[]) : null;
      const sim = vec ? cosineSimilarity(emb.values as number[], vec) : 0;
      return { p, sim };
    })
    .filter((x) => x.sim > 0.5)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, limit);
  return { ok: true, data: scored.map(({ p, sim }) => toCandidate(p, sim, 'semantic match', ['vector_text'])) };
}

/** Price of one product (active_price = campaign-adjusted truth). */
export async function getProductPrice(db: Kysely<DB>, productId: string): Promise<ToolResult<{ price: number | null; name: string } | null>> {
  const data = await productSelect(db).where('products.id', '=', productId).executeTakeFirst();
  if (!data) return { ok: true, data: null };
  return { ok: true, data: { price: data.active_price ?? null, name: customerProductName(data) } };
}

/** Sibling products in the same code family (simple "other options" — no variant graph). */
export async function getProductOptions(db: Kysely<DB>, productId: string, limit = 5): Promise<ToolResult<ProductCandidate[]>> {
  const base = await db.selectFrom('products').select(['product_code', 'category']).where('id', '=', productId).executeTakeFirst();
  const code = base?.product_code ?? undefined;
  const family = code ? normalizeCode(code).slice(0, 6) : '';
  if (family.length >= 4) {
    const rows = (
      await activePriced(productSelect(db)).where('products.product_code', 'ilike', `%${family}%`).where('products.id', '!=', productId).limit(limit).execute()
    ).filter((p) => normalizeCode(p.product_code).startsWith(family));
    if (rows.length) return { ok: true, data: rows.map((p) => toCandidate(p, 0.5, 'same product family')) };
  }
  // Fallback: same category.
  const cat = base?.category ?? undefined;
  if (cat) {
    const rows = await activePriced(productSelect(db)).where('products.category', '=', cat).where('products.id', '!=', productId).limit(limit).execute();
    return { ok: true, data: rows.map((p) => toCandidate(p, 0.4, 'same category')) };
  }
  return { ok: true, data: [] };
}
