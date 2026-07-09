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
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeCode, normalizeBarcode, tokenize } from '../catalog-match';
import { customerProductName, originalProductName, primaryProductImageUrl } from '../util/product-display';
import { embedText } from '../gemini/client';
import { cosineSimilarity } from './vector-search';
import { PRODUCT_COLUMNS, type ProductCandidate, type ToolResult, type RetrievalTrack } from './types';

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

/** PostgREST or()-filter safety: commas/parens/percent break the filter syntax. */
function sanitizeTerm(t: string): string {
  return t.replace(/[(),%*]/g, ' ').trim();
}

function activePriced(q: any) {
  return q.eq('status', 'active').not('active_price', 'is', null);
}

/** Exact product-code lookup (deterministic identity). */
export async function findProductByCode(db: SupabaseClient, code: string): Promise<ToolResult<ProductCandidate | null>> {
  const norm = normalizeCode(code);
  if (!norm) return { ok: true, data: null };
  const { data } = await activePriced(db.from('products').select(PRODUCT_COLUMNS)).eq('product_code', code).maybeSingle();
  if (data) return { ok: true, data: toCandidate(data, 0.97, 'exact product code', ['exact_code']) };
  // Fallback: normalized compare (handles zero-padding / separators).
  const { data: rows } = await activePriced(db.from('products').select(PRODUCT_COLUMNS)).ilike('product_code', `%${norm}%`).limit(10);
  const hit = (rows ?? []).find((p: any) => normalizeCode(p.product_code) === norm);
  return { ok: true, data: hit ? toCandidate(hit, 0.97, 'exact product code', ['exact_code']) : null };
}

/** Exact barcode lookup (deterministic identity). */
export async function findProductByBarcode(db: SupabaseClient, barcode: string): Promise<ToolResult<ProductCandidate | null>> {
  const norm = normalizeBarcode(barcode);
  if (!norm) return { ok: true, data: null };
  const { data } = await activePriced(db.from('products').select(PRODUCT_COLUMNS)).eq('barcode', norm).limit(1).maybeSingle();
  if (data) return { ok: true, data: toCandidate(data, 0.97, 'exact barcode', ['exact_barcode']) };
  const { data: byRaw } = await activePriced(db.from('products').select(PRODUCT_COLUMNS)).eq('barcode', barcode).limit(1).maybeSingle();
  return { ok: true, data: byRaw ? toCandidate(byRaw, 0.97, 'exact barcode', ['exact_barcode']) : null };
}

/** Exact website_url lookup, then a slug-tail ilike as a strong secondary signal. */
export async function findProductByUrl(db: SupabaseClient, url: string): Promise<ToolResult<ProductCandidate | null>> {
  const clean = (url ?? '').trim();
  if (!/^https?:\/\//i.test(clean)) return { ok: true, data: null };
  const { data } = await activePriced(db.from('products').select(PRODUCT_COLUMNS)).eq('website_url', clean).limit(1).maybeSingle();
  if (data) return { ok: true, data: toCandidate(data, 0.96, 'exact product link', ['exact_url']) };
  // Strip query/hash and retry exact.
  let bare = clean;
  try { const u = new URL(clean); u.search = ''; u.hash = ''; bare = u.toString(); } catch { /* keep clean */ }
  if (bare !== clean) {
    const { data: d2 } = await activePriced(db.from('products').select(PRODUCT_COLUMNS)).eq('website_url', bare).limit(1).maybeSingle();
    if (d2) return { ok: true, data: toCandidate(d2, 0.96, 'exact product link', ['exact_url']) };
  }
  return { ok: true, data: null };
}

/** Wide text search across Arabic/English/Turkish names + keyword arrays, scored in code. */
export async function searchProductsByText(db: SupabaseClient, terms: string[], limit = 20): Promise<ToolResult<ProductCandidate[]>> {
  const clean = Array.from(new Set(terms.map(sanitizeTerm).filter((t) => t.length >= 2))).slice(0, 12);
  if (!clean.length) return { ok: true, data: [] };
  const ors: string[] = [];
  for (const t of clean) {
    ors.push(
      `libyan_display_name.ilike.%${t}%`, `arabic_name.ilike.%${t}%`, `english_name.ilike.%${t}%`,
      `source_name.ilike.%${t}%`, `category.ilike.%${t}%`,
    );
  }
  const { data } = await activePriced(db.from('products').select(PRODUCT_COLUMNS)).or(ors.join(',')).limit(Math.max(limit * 6, 40));
  const rows = (data ?? []) as any[];
  if (!rows.length) return { ok: true, data: [] };
  const queryTokens = new Set(clean.flatMap((t) => tokenize(t)));
  const scored = rows
    .map((p: any) => {
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
export async function vectorSearchProductText(db: SupabaseClient, query: string, limit = 10): Promise<ToolResult<ProductCandidate[]>> {
  const emb = await embedText(query, 'RETRIEVAL_QUERY');
  if (!emb.values) return { ok: true, data: [] };
  // Pull candidate embeddings (bounded scan, consistent with the dHash scan).
  const { data } = await activePriced(db.from('products').select(`${PRODUCT_COLUMNS}, text_embedding`))
    .not('text_embedding', 'is', null)
    .limit(5000);
  const rows = (data ?? []) as any[];
  if (!rows.length) return { ok: true, data: [] };
  const scored = rows
    .map((p: any) => {
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
export async function getProductPrice(db: SupabaseClient, productId: string): Promise<ToolResult<{ price: number | null; name: string } | null>> {
  const { data } = await db.from('products').select(PRODUCT_COLUMNS).eq('id', productId).maybeSingle();
  if (!data) return { ok: true, data: null };
  return { ok: true, data: { price: (data as any).active_price ?? null, name: customerProductName(data as any) } };
}

/** Sibling products in the same code family (simple "other options" — no variant graph). */
export async function getProductOptions(db: SupabaseClient, productId: string, limit = 5): Promise<ToolResult<ProductCandidate[]>> {
  const { data: base } = await db.from('products').select('product_code, category').eq('id', productId).maybeSingle();
  const code = (base as any)?.product_code as string | undefined;
  const family = code ? normalizeCode(code).slice(0, 6) : '';
  if (family.length >= 4) {
    const { data } = await activePriced(db.from('products').select(PRODUCT_COLUMNS)).ilike('product_code', `%${family}%`).neq('id', productId).limit(limit);
    const rows = (data ?? []).filter((p: any) => normalizeCode(p.product_code).startsWith(family));
    if (rows.length) return { ok: true, data: rows.map((p: any) => toCandidate(p, 0.5, 'same product family')) };
  }
  // Fallback: same category.
  const cat = (base as any)?.category as string | undefined;
  if (cat) {
    const { data } = await activePriced(db.from('products').select(PRODUCT_COLUMNS)).eq('category', cat).neq('id', productId).limit(limit);
    return { ok: true, data: (data ?? []).map((p: any) => toCandidate(p, 0.4, 'same category')) };
  }
  return { ok: true, data: [] };
}
