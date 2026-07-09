/**
 * CANONICAL customer-image → product matcher. Shared by the live Messenger
 * pipeline AND the AI Playground so both behave identically.
 *
 * Hybrid recognition pipeline (each step recorded in `diagnostics`):
 *   1. Exact product_images.public_url lookup (customer pasted our own image URL).
 *   2. dHash fingerprint of the customer image.
 *   3. Admin-correction memory  (image_match_corrections + product_fingerprints).
 *   4. Near-duplicate fingerprint match against stored product image hashes.
 *   5. Gemini vision DESCRIBE → keywords + any visible code/barcode.
 *   6. Exact code/barcode lookup from text seen in the image.
 *   7. Candidate retrieval: keyword catalog search + semantic vector search
 *      (embedding of the vision description) + fingerprint-similar union.
 *   8. Gemini vision ranking + multi-signal confidence combine (Gemini + pHash).
 *
 * Hard safety: only active, priced products are surfaced; Turkish source_name is
 * never customer-facing; no invented prices.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import {
  describeProductImage,
  matchProductFromImage,
  rankProductsByImage,
  isGeminiConfigured,
  embedText,
  type ProductContext,
  type VisualRankItem,
} from '../gemini';
import { fetchImageBase64Detailed } from '../util/base64';
import { normalizeCode, normalizeBarcode } from '../catalog-match';
import { dhashFromBytes, hammingHex, hammingSimilarity, NEAR_DUPLICATE_MAX, SIMILAR_MAX } from '../util/image-hash';
import { customerProductName } from '../util/product-display';
import {
  findProductByCode, findProductByBarcode, vectorSearchProductText, toCandidate,
  type ProductCandidate,
} from '../tools';
import { productSelect, activePriced, searchProductRows } from '../tools/products';

/** Back-compat alias — the canonical candidate shape now lives in the tools layer. */
export type ImageMatchCandidate = ProductCandidate;

export interface ImageMatchResult {
  outcome: 'exact' | 'multiple' | 'none';
  candidates: ProductCandidate[];
  exactProductId: string | null;
  customerImageHash: string | null;
  diagnostics: Record<string, unknown>;
}

export interface MatchCustomerImageOpts {
  imageUrl?: string | null;
  imageBase64?: string | null;
  mimeType?: string | null;
  extraText?: string;
  /** Internal customer-memory context (helps "the one I sent before"). */
  memoryContext?: string;
  behaviorSystemPrompt?: string;
  baseDiagnostics?: Record<string, unknown>;
  searchLimit?: number;
}

function host(url?: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).host; } catch { return null; }
}
function withoutQuery(url: string): string {
  try { const u = new URL(url); u.search = ''; u.hash = ''; return u.toString(); } catch { return url; }
}
/** Smallest Hamming distance between a customer hash and any of a product's image hashes. */
function bestHashDistance(p: any, customerHash: string | null): number {
  if (!customerHash) return 999;
  const imgs = (p?.product_images ?? []) as { perceptual_hash?: string | null }[];
  let best = 999;
  for (const im of imgs) {
    const d = hammingHex(customerHash, im?.perceptual_hash ?? null);
    if (d < best) best = d;
  }
  return best;
}

async function findById(db: Kysely<DB>, id: string): Promise<any | null> {
  const data = await activePriced(productSelect(db)).where('products.id', '=', id).executeTakeFirst();
  return data ?? null;
}

async function findByExactImageUrl(db: Kysely<DB>, imageUrl: string): Promise<any | null> {
  for (const url of Array.from(new Set([imageUrl, withoutQuery(imageUrl)]))) {
    const img = await db.selectFrom('product_images').select('product_id').where('public_url', '=', url).limit(1).executeTakeFirst();
    if (!img?.product_id) continue;
    const product = await findById(db, img.product_id);
    if (product) return product;
  }
  return null;
}

/**
 * LEARNED matches: nearest customer-image hash an admin previously linked to a
 * product, across BOTH the legacy corrections table and the product_fingerprints
 * learning store. Returns the product if within SIMILAR_MAX.
 */
async function findByLearnedFingerprint(db: Kysely<DB>, customerHash: string): Promise<{ product: any | null; distance: number }> {
  let bestId: string | null = null;
  let bestDist = 999;
  const corr = await db
    .selectFrom('image_match_corrections')
    .select(['customer_image_hash', 'corrected_product_id'])
    .where('corrected_product_id', 'is not', null)
    .where('customer_image_hash', 'is not', null)
    .orderBy('created_at', 'desc')
    .limit(1000)
    .execute();
  for (const r of corr) {
    const d = hammingHex(customerHash, r.customer_image_hash);
    if (d < bestDist) { bestDist = d; bestId = r.corrected_product_id; }
  }
  const fp = await db
    .selectFrom('product_fingerprints')
    .select(['hash_hex', 'product_id'])
    .orderBy('created_at', 'desc')
    .limit(2000)
    .execute();
  for (const r of fp) {
    const d = hammingHex(customerHash, r.hash_hex);
    if (d < bestDist) { bestDist = d; bestId = r.product_id; }
  }
  if (bestId && bestDist <= SIMILAR_MAX) return { product: await findById(db, bestId), distance: bestDist };
  return { product: null, distance: bestDist };
}

/** Scan active+priced product image fingerprints; per-product best distance, ascending. */
async function scanProductImageHashes(db: Kysely<DB>, customerHash: string): Promise<{ product_id: string; distance: number }[]> {
  const data = await db
    .selectFrom('product_images')
    .innerJoin('products', 'products.id', 'product_images.product_id')
    .select(['product_images.product_id', 'product_images.perceptual_hash'])
    .where('product_images.perceptual_hash', 'is not', null)
    .where('products.status', '=', 'active')
    .where('products.active_price', 'is not', null)
    .limit(8000)
    .execute();
  const best = new Map<string, number>();
  for (const r of data) {
    const d = hammingHex(customerHash, r.perceptual_hash);
    const cur = best.get(r.product_id);
    if (cur === undefined || d < cur) best.set(r.product_id, d);
  }
  return [...best.entries()].map(([product_id, distance]) => ({ product_id, distance })).sort((a, b) => a.distance - b.distance);
}

async function findSimilarByImage(db: Kysely<DB>, customerHash: string, maxDist: number, limit: number): Promise<any[]> {
  const ranked = (await scanProductImageHashes(db, customerHash)).filter((r) => r.distance <= maxDist).slice(0, limit);
  const out: any[] = [];
  for (const r of ranked) { const p = await findById(db, r.product_id); if (p) out.push(p); }
  return out;
}

export async function matchCustomerImage(db: Kysely<DB>, opts: MatchCustomerImageOpts): Promise<ImageMatchResult> {
  const searchLimit = opts.searchLimit ?? 50;
  let customerHash: string | null = null;
  const diagnostics: Record<string, unknown> = {
    ...(opts.baseDiagnostics ?? {}),
    attachment_url_present: !!opts.imageUrl,
    attachment_url_host: host(opts.imageUrl),
    image_download_ok: false,
    image_bytes_size: null,
    exact_url_match: false,
    customer_image_hash: null,
    correction_match: false,
    hash_near_dup: false,
    hash_best_distance: null,
    gemini_vision_called: false,
    gemini_vision_success: false,
    gemini_result_summary: null,
    vector_track_used: false,
    vector_candidates: 0,
    catalog_candidates_count: 0,
    merged_pool_size: 0,
    top_candidate_product_codes: [] as string[],
    top_candidate_names: [] as string[],
    signal_combine: 'gemini+phash+vector',
    outcome: 'none',
    confidence: 0,
    failure_reason: null,
  };

  const finish = (r: Omit<ImageMatchResult, 'diagnostics' | 'customerImageHash'>): ImageMatchResult => {
    diagnostics.outcome = r.outcome;
    diagnostics.confidence = r.candidates[0]?.confidence ?? 0;
    diagnostics.top_candidate_product_codes = r.candidates.map((c) => c.product_code).filter(Boolean).slice(0, 5);
    diagnostics.top_candidate_names = r.candidates.map((c) => c.name).slice(0, 5);
    return { ...r, customerImageHash: customerHash, diagnostics };
  };

  // 1. Exact image-URL lookup.
  if (opts.imageUrl) {
    const exact = await findByExactImageUrl(db, opts.imageUrl);
    if (exact) {
      diagnostics.exact_url_match = true;
      diagnostics.gemini_result_summary = 'Exact product image URL match.';
      return finish({ outcome: 'exact', exactProductId: exact.id, candidates: [toCandidate(exact, 1, 'exact image url', ['exact_url'])] });
    }
  }

  // 2. Obtain image bytes (8s timeout, 20MB cap).
  let base64 = opts.imageBase64 ?? null;
  let mimeType = opts.mimeType ?? null;
  if (!base64 && opts.imageUrl) {
    const dl = await fetchImageBase64Detailed(opts.imageUrl);
    diagnostics.image_download_ok = dl.ok;
    diagnostics.image_bytes_size = dl.bytesSize ?? null;
    if (!dl.ok || !dl.data) {
      diagnostics.failure_reason = dl.error || 'image_download_failed';
      return finish({ outcome: 'none', exactProductId: null, candidates: [] });
    }
    base64 = dl.data;
    mimeType = dl.mimeType ?? 'image/jpeg';
  } else if (base64) {
    diagnostics.image_download_ok = true;
  }
  if (!base64 || !mimeType) {
    diagnostics.failure_reason = 'no_image_bytes';
    return finish({ outcome: 'none', exactProductId: null, candidates: [] });
  }

  // 2b. Perceptual fingerprint.
  customerHash = await dhashFromBytes(Buffer.from(base64, 'base64'));
  diagnostics.customer_image_hash = customerHash;

  if (customerHash) {
    // 3. LEARNED corrections / fingerprints.
    const learned = await findByLearnedFingerprint(db, customerHash);
    if (learned.product) {
      diagnostics.correction_match = true;
      diagnostics.hash_best_distance = learned.distance;
      diagnostics.gemini_result_summary = 'Matched a past admin correction / learned fingerprint.';
      return finish({ outcome: 'exact', exactProductId: learned.product.id, candidates: [toCandidate(learned.product, 0.99, 'learned from admin correction', ['correction_memory'])] });
    }
    // 4. NEAR-DUPLICATE of our own catalog photo.
    const ranked = await scanProductImageHashes(db, customerHash);
    const top = ranked[0];
    diagnostics.hash_best_distance = top ? top.distance : null;
    if (top && top.distance <= NEAR_DUPLICATE_MAX) {
      const p = await findById(db, top.product_id);
      if (p) {
        diagnostics.hash_near_dup = true;
        diagnostics.gemini_result_summary = `Image fingerprint near-duplicate (distance ${top.distance}).`;
        return finish({ outcome: 'exact', exactProductId: p.id, candidates: [toCandidate(p, hammingSimilarity(top.distance), 'same product photo', ['hash_near_dup'])] });
      }
    }
  }

  if (!isGeminiConfigured()) {
    diagnostics.failure_reason = 'gemini_not_configured';
    return finish({ outcome: 'none', exactProductId: null, candidates: [] });
  }

  // 5. Vision describe → keywords (+ visible code/barcode). A vision timeout must
  // DEGRADE (keep matching on dHash/keyword/vector), never throw a 504.
  let desc: Awaited<ReturnType<typeof describeProductImage>>;
  try {
    desc = await describeProductImage({
      imageBase64: base64, mimeType, extraText: [opts.extraText, opts.memoryContext].filter(Boolean).join('\n'),
      instructions: opts.behaviorSystemPrompt,
    });
  } catch (e: any) {
    diagnostics.vision_describe_error = e?.timeout ? 'timeout' : (e?.message ?? 'error');
    desc = { ok: false, reason: 'not_configured', missing: [] } as any;
  }
  diagnostics.gemini_vision_called = true;
  let keywords: string[] = [];
  let descriptionText = '';
  if (desc.ok) {
    diagnostics.gemini_vision_success = true;
    diagnostics.gemini_result_summary = desc.result.summary || desc.result.product_type || 'described';
    keywords = [desc.result.product_type ?? '', desc.result.color ?? '', desc.result.material ?? '', ...desc.result.keywords_en, ...desc.result.keywords_ar].filter(Boolean);
    descriptionText = [desc.result.summary, desc.result.product_type, desc.result.color, desc.result.material, ...desc.result.keywords_en, ...desc.result.keywords_ar].filter(Boolean).join(' ');

    // 6. Exact code/barcode from text seen in the image.
    const codeText = desc.result.code_text ? normalizeCode(desc.result.code_text) : '';
    if (codeText) {
      const byCode = await findProductByCode(db, codeText);
      if (byCode.ok && byCode.data) {
        diagnostics.gemini_result_summary = `Matched visible product code ${codeText}.`;
        return finish({ outcome: 'exact', exactProductId: byCode.data.id, candidates: [byCode.data] });
      }
    }
    const barcodeText = desc.result.barcode_text ? normalizeBarcode(desc.result.barcode_text) : null;
    if (barcodeText) {
      const byBarcode = await findProductByBarcode(db, barcodeText);
      if (byBarcode.ok && byBarcode.data) {
        diagnostics.gemini_result_summary = `Matched visible barcode ${barcodeText}.`;
        return finish({ outcome: 'exact', exactProductId: byBarcode.data.id, candidates: [byBarcode.data] });
      }
    }
  }

  // 7. Candidate retrieval: keyword search + semantic vector + fingerprint union.
  // IMPORTANT: never fall back to an arbitrary slice of active products when the
  // keyword search is empty — that produced confident-looking but random matches.
  // If no real signal yields candidates, we return outcome 'none' and the caller
  // asks one natural clarifying question instead.
  const pool: any[] = await searchProductRows(db, keywords, searchLimit, 10);
  const haveIds = new Set(pool.map((p: any) => p.id));
  // Semantic vector candidates from the vision description.
  if (descriptionText.trim().length >= 3) {
    const vec = await vectorSearchProductText(db, descriptionText, 10);
    if (vec.ok && vec.data.length) {
      diagnostics.vector_track_used = true;
      diagnostics.vector_candidates = vec.data.length;
      for (const c of vec.data) {
        if (haveIds.has(c.id)) continue;
        const p = await findById(db, c.id);
        if (p) { pool.push(p); haveIds.add(p.id); }
      }
    }
  }
  // Fingerprint-similar union.
  if (customerHash) {
    const sim = await findSimilarByImage(db, customerHash, SIMILAR_MAX, 10);
    for (const p of sim) if (!haveIds.has(p.id)) { pool.push(p); haveIds.add(p.id); }
  }
  diagnostics.catalog_candidates_count = pool.length;
  diagnostics.merged_pool_size = pool.length;
  if (pool.length === 0) {
    diagnostics.failure_reason = 'no_active_priced_products';
    return finish({ outcome: 'none', exactProductId: null, candidates: [] });
  }

  // 8. Gemini ranks the REAL candidate set against the image. A vision timeout
  // must DEGRADE to the dHash/keyword/vector signals we already have — never 504.
  const ctx: ProductContext[] = pool.map((p: any) => ({ id: p.id, name: customerProductName(p), category: p.category, price: p.active_price }));
  let ranked: Awaited<ReturnType<typeof matchProductFromImage>>;
  try {
    ranked = await matchProductFromImage({
      imageBase64: base64, mimeType, candidates: ctx, extraText: opts.extraText, instructions: opts.behaviorSystemPrompt,
    });
  } catch (e: any) {
    diagnostics.vision_rank_error = e?.timeout ? 'timeout' : (e?.message ?? 'error');
    ranked = { ok: true, result: { outcome: 'none', matches: [] }, latencyMs: 0, model: 'degraded' } as any;
  }
  if (!ranked.ok) {
    diagnostics.failure_reason = 'gemini_not_configured';
    return finish({ outcome: 'none', exactProductId: null, candidates: [] });
  }
  const visionDegraded = !!diagnostics.vision_rank_error;
  const geminiById = new Map<string, { confidence: number; reason?: string }>();
  for (const m of ranked.result.matches) if (m.product_id) geminiById.set(m.product_id, { confidence: m.confidence ?? 0, reason: m.reason });

  // Multi-signal combine: Gemini semantic + image-fingerprint similarity.
  const scored = pool.map((p: any) => {
    const g = geminiById.get(p.id);
    const gemini = g?.confidence ?? 0;
    const dist = bestHashDistance(p, customerHash);
    const phashSim = hammingSimilarity(dist);
    let confidence: number;
    let reason: string | null = g?.reason ?? null;
    if (customerHash && dist < 999) {
      confidence = 0.55 * gemini + 0.45 * phashSim;
      if (dist <= NEAR_DUPLICATE_MAX) { confidence = Math.max(confidence, 0.95); reason = 'matching product photo'; }
      else if (dist <= SIMILAR_MAX) { confidence = Math.max(confidence, 0.6 + phashSim * 0.3); reason = reason ?? 'similar product photo'; }
    } else {
      confidence = gemini;
    }
    // Vision timed out: keep the keyword/vector pool visible at low confidence so
    // the admin/customer still gets candidates instead of an empty result.
    if (visionDegraded && gemini === 0 && (dist === 999 || dist > SIMILAR_MAX)) {
      confidence = Math.max(confidence, 0.3);
      reason = reason ?? 'keyword/vector match (vision unavailable)';
    }
    return { p, confidence, reason, gemini, dist };
  })
    .filter((x) => x.gemini > 0 || x.dist <= SIMILAR_MAX || visionDegraded)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);

  const candidates: ProductCandidate[] = scored.map((x) => toCandidate(x.p, x.confidence, x.reason));

  // When name-matching produced no confident results (all candidates filtered) but
  // keyword/vector search found real products, run a visual re-rank (image-to-image)
  // before giving up. Name-matching is weak for lifestyle/marketing photos where the
  // image doesn't look like a clean product shot — comparing actual product images to
  // the customer photo is far more accurate in those cases.
  // If visual re-rank also returns nothing, surface the keyword pool at low confidence
  // so the customer sees plausible options instead of being routed immediately to admin.
  if (candidates.length === 0 && pool.length > 0 && !visionDegraded) {
    diagnostics.visual_rerank_rescue = 'attempted';
    const topPool = (pool as any[]).slice(0, 6);
    const dls = await Promise.all(
      topPool.map(async (p) => {
        const imgs = (p.product_images ?? []) as { public_url?: string | null; is_primary?: boolean }[];
        const url = (imgs.find((im) => im.is_primary) ?? imgs[0])?.public_url ?? null;
        const dl = url ? await fetchImageBase64Detailed(url) : { ok: false, data: null, mimeType: null };
        return { p, dl };
      }),
    );
    const items: VisualRankItem[] = dls
      .filter(({ dl }) => (dl as any).ok && (dl as any).data)
      .map(({ p, dl }) => ({ id: p.id, name: customerProductName(p), imageBase64: (dl as any).data, mimeType: (dl as any).mimeType ?? 'image/jpeg' }));
    if (items.length >= 1) {
      try {
        const vr = await rankProductsByImage({
          customerImageBase64: base64, customerMimeType: mimeType, candidates: items,
          extraText: opts.extraText, instructions: opts.behaviorSystemPrompt,
        });
        if (vr.ok && vr.ranked.length) {
          const byId = new Map(vr.ranked.map((r) => [r.product_id, r] as const));
          const rescued = topPool
            .map((p) => { const s = byId.get(p.id); return { p, confidence: s?.confidence ?? 0, reason: s?.reason ?? null }; })
            .filter((x) => x.confidence > 0)
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 5);
          if (rescued.length > 0) {
            diagnostics.visual_rerank_rescue = 'succeeded';
            const rescuedCandidates = rescued.map((x) => toCandidate(x.p, x.confidence, x.reason ?? 'visual match'));
            const top = rescuedCandidates[0];
            const second = rescuedCandidates[1];
            const isExact = top.confidence >= 0.82 && (!second || top.confidence - second.confidence >= 0.18);
            return finish({ outcome: isExact ? 'exact' : 'multiple', exactProductId: isExact ? top.id : null, candidates: rescuedCandidates });
          }
        }
      } catch { /* best-effort: a visual re-rank error must not kill the turn */ }
    }
    // Keyword-matched but visually unconfirmable — return at low confidence so the
    // customer gets plausible options rather than an immediate "needs human" dead end.
    // These are keyword-relevant products, not random.
    const keywordFallback = (pool as any[]).slice(0, 5).map((p) => toCandidate(p, 0.35, 'keyword match'));
    diagnostics.visual_rerank_rescue = 'keyword_fallback';
    return finish({ outcome: 'multiple', exactProductId: null, candidates: keywordFallback });
  }

  if (candidates.length === 0) {
    diagnostics.failure_reason = 'no_confident_product_match';
    return finish({ outcome: 'none', exactProductId: null, candidates: [] });
  }

  // Visual re-rank to improve ordering when multiple ambiguous candidates survive.
  // The !customerHash guard is removed — visual comparison improves accuracy whether
  // or not we have a hash (products without stored perceptual hashes benefit most).
  if (candidates.length >= 2) {
    const withImages = candidates.filter((c) => c.image).slice(0, 4);
    const dls = await Promise.all(
      withImages.map(async (c) => ({ c, dl: await fetchImageBase64Detailed(c.image as string) })),
    );
    const items: VisualRankItem[] = [];
    for (const { c, dl } of dls) {
      if (dl.ok && dl.data) items.push({ id: c.id, name: c.name, imageBase64: dl.data, mimeType: dl.mimeType || 'image/jpeg' });
    }
    if (items.length >= 2) {
      const vr = await rankProductsByImage({
        customerImageBase64: base64, customerMimeType: mimeType, candidates: items, extraText: opts.extraText, instructions: opts.behaviorSystemPrompt,
      });
      if (vr.ok && vr.ranked.length) {
        const byId = new Map(vr.ranked.map((r) => [r.product_id, r] as const));
        for (const c of candidates) { const s = byId.get(c.id); if (s) { c.confidence = s.confidence; if (s.reason) c.reason = s.reason; } }
        candidates.sort((a, b) => b.confidence - a.confidence);
      }
    }
  }

  const top = candidates[0];
  const second = candidates[1];
  const isExact = top.confidence >= 0.82 && (!second || top.confidence - second.confidence >= 0.18);
  return finish({ outcome: isExact ? 'exact' : 'multiple', exactProductId: isExact ? top.id : null, candidates });
}
