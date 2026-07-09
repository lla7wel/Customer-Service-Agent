/**
 * Canonical TEXT/URL → catalog product resolver. Runs the full deterministic +
 * semantic retrieval internally, then returns the strongest candidates:
 *
 *   1. Parse any URL → exact website_url lookup, then code/barcode in the URL.
 *   2. Exact product_code / barcode typed in the message.
 *   3. Keyword search (Arabic/English/Turkish names + keyword arrays).
 *   4. Semantic vector search (real Gemini embeddings) for loose wording.
 *   → merge + dedupe, ranked by confidence.
 *
 * All retrieval goes through the controlled tools layer, so the hard safety
 * (active+priced only, catalog-safe names, active_price) is enforced in one place.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { tokenize } from '../catalog-match';
import {
  findProductByCode, findProductByBarcode, findProductByUrl,
  searchProductsByText, vectorSearchProductText,
  type ProductCandidate,
} from '../tools';

export type ProductHit = ProductCandidate;

export interface ResolveResult {
  hits: ProductCandidate[];
  parsed: { urls: string[]; code: string | null; barcode: string | null; slugTokens: string[]; keywords: string[] };
  outcome: 'exact' | 'multiple' | 'none';
}

const URL_RE = /https?:\/\/[^\s)]+/gi;

/**
 * Pull product signals out of any English Home URL in the text: digit runs →
 * code/barcode candidates; the last meaningful path segment → slug keywords.
 */
export function parseProductUrl(text: string): { urls: string[]; code: string | null; barcode: string | null; slugTokens: string[] } {
  const urls = (text.match(URL_RE) ?? []).map((u) => u.replace(/[.,]+$/, ''));
  let code: string | null = null;
  let barcode: string | null = null;
  const slugTokens: string[] = [];
  for (const raw of urls) {
    let u: URL | null = null;
    try { u = new URL(raw); } catch { continue; }
    const digitRuns = (u.pathname + ' ' + u.search).match(/\d{6,}/g) ?? [];
    for (const d of digitRuns) {
      if (d.length >= 12 && d.length <= 14 && !barcode) barcode = d;
      else if (!code) code = d;
    }
    const segs = u.pathname.split('/').map((s) => decodeURIComponent(s)).filter(Boolean);
    for (let i = segs.length - 1; i >= 0; i--) {
      const seg = segs[i];
      if (/^\d+$/.test(seg)) continue;
      if (/^(p|product|urun|c|category|tr|ar|en)$/i.test(seg)) continue;
      slugTokens.push(...tokenize(seg.replace(/-/g, ' ')).filter((t) => !/^\d+$/.test(t)));
      break;
    }
  }
  return { urls, code, barcode, slugTokens };
}

function mergeDedupe(lists: ProductCandidate[][], limit: number): ProductCandidate[] {
  const byId = new Map<string, ProductCandidate>();
  for (const list of lists) {
    for (const c of list) {
      const prev = byId.get(c.id);
      if (!prev) {
        byId.set(c.id, { ...c, retrieval_tracks: [...(c.retrieval_tracks ?? [])] });
      } else {
        // Keep the higher confidence; union the tracks.
        prev.confidence = Math.max(prev.confidence, c.confidence);
        prev.retrieval_tracks = Array.from(new Set([...(prev.retrieval_tracks ?? []), ...(c.retrieval_tracks ?? [])]));
        if (!prev.reason && c.reason) prev.reason = c.reason;
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}

/** Resolve a customer's text/URL product question to ranked catalog hits. */
export async function resolveProductsFromText(db: Kysely<DB>, text: string, limit = 5): Promise<ResolveResult> {
  const { urls, code: urlCode, barcode: urlBarcode, slugTokens } = parseProductUrl(text);
  const bareDigits = text.replace(URL_RE, ' ').replace(/\D+/g, '');
  const codeHint = urlCode ?? (bareDigits.length >= 6 ? bareDigits : null);
  const barcodeHint = urlBarcode ?? (bareDigits.length >= 12 ? bareDigits : null);
  const parsed = { urls, code: codeHint, barcode: barcodeHint, slugTokens, keywords: [] as string[] };

  // 1. Exact identity wins — link, then code, then barcode.
  for (const url of urls) {
    const r = await findProductByUrl(db, url);
    if (r.ok && r.data) return { hits: [r.data], parsed, outcome: 'exact' };
  }
  if (codeHint) {
    const r = await findProductByCode(db, codeHint);
    if (r.ok && r.data) return { hits: [r.data], parsed, outcome: 'exact' };
  }
  if (barcodeHint) {
    const r = await findProductByBarcode(db, barcodeHint);
    if (r.ok && r.data) return { hits: [r.data], parsed, outcome: 'exact' };
  }

  // 2. Keyword + semantic retrieval, merged.
  const textTokens = tokenize(text.replace(URL_RE, ' '));
  const queryTokens = Array.from(new Set([...textTokens, ...slugTokens]));
  parsed.keywords = queryTokens;
  const cleanQuery = text.replace(URL_RE, ' ').trim();

  const [kw, vec] = await Promise.all([
    queryTokens.length ? searchProductsByText(db, queryTokens, Math.max(limit * 2, 10)) : Promise.resolve({ ok: true as const, data: [] }),
    cleanQuery.length >= 3 ? vectorSearchProductText(db, cleanQuery, Math.max(limit * 2, 10)) : Promise.resolve({ ok: true as const, data: [] }),
  ]);
  const kwHits = kw.ok ? kw.data : [];
  const vecHits = vec.ok ? vec.data : [];
  const hits = mergeDedupe([kwHits, vecHits], limit);
  if (!hits.length) return { hits: [], parsed, outcome: 'none' };
  return { hits, parsed, outcome: hits.length === 1 ? 'exact' : 'multiple' };
}
