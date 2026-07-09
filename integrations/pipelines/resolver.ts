/**
 * Unified product resolver for ADMIN surfaces — turns an admin signal (text,
 * code, barcode, URL, or image) into ranked catalog candidates. It does not
 * re-implement matching: it composes the two canonical engines so there is no
 * weaker per-page logic:
 *
 *   • text / code / barcode / URL / keyword / vector → resolveProductsFromText()
 *   • image (bytes or url) → matchCustomerImage()  (dHash + vision + vector)
 *
 * Used by: AI Playground, Inbox product/image search + attach, Catalog Review
 * image search, Campaign product picker. The live Messenger pipeline calls the
 * same underlying engines directly (with its own follow-up logic), so every
 * surface shares identical matching + the hard safety rules (active+priced only,
 * catalog-safe names, active_price) enforced in the tools layer.
 *
 *   mode:'customer' → diagnostics stripped (never leak internals to a customer)
 *   mode:'admin'    → diagnostics + timing returned for the admin debug panels
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import type { ProductCandidate } from '../tools';
import { resolveProductsFromText } from './product-resolve';
import { matchCustomerImage } from './image-match';

export type ResolveMode = 'customer' | 'admin';

export interface ResolveInput {
  /** Free text: question, product code, barcode, or a product URL. */
  text?: string | null;
  /** Image bytes (base64, no data: prefix) to match against the catalog. */
  imageBase64?: string | null;
  /** OR an image URL to download + match. */
  imageUrl?: string | null;
  mimeType?: string | null;
  limit?: number;
  mode?: ResolveMode;
  /** Internal customer-memory note (helps "the one I sent before"). Admin/customer. */
  memoryContext?: string;
  /** Admin-configured image-matching behavior prompt. */
  behaviorSystemPrompt?: string;
}

export interface ResolveOutput {
  /** Which engine produced the result. */
  source: 'image' | 'text' | 'empty';
  outcome: 'exact' | 'multiple' | 'none';
  candidates: ProductCandidate[];
  /** Parsed signals (text path): extracted code/barcode/url/keywords. */
  parsed?: Record<string, unknown>;
  /** Engine diagnostics (admin mode only — stripped in customer mode). */
  diagnostics?: Record<string, unknown>;
  /** Total wall-clock time in ms (admin mode). */
  timingMs?: number;
}

/**
 * Resolve products from any signal. Image wins when image bytes/url are present
 * (a photo is the strongest intent), otherwise the text engine runs.
 */
export async function resolveProducts(db: Kysely<DB>, input: ResolveInput): Promise<ResolveOutput> {
  const mode: ResolveMode = input.mode ?? 'customer';
  const limit = input.limit ?? 5;
  const started = Date.now();

  // --- Image path -----------------------------------------------------------
  if (input.imageBase64 || input.imageUrl) {
    const r = await matchCustomerImage(db, {
      imageBase64: input.imageBase64 ?? undefined,
      imageUrl: input.imageUrl ?? undefined,
      mimeType: input.mimeType ?? undefined,
      extraText: input.text || undefined,
      memoryContext: input.memoryContext,
      behaviorSystemPrompt: input.behaviorSystemPrompt,
      searchLimit: Math.max(limit, 50),
    });
    return {
      source: 'image',
      outcome: r.outcome,
      candidates: r.candidates.slice(0, limit),
      diagnostics: mode === 'admin' ? r.diagnostics : undefined,
      timingMs: mode === 'admin' ? Date.now() - started : undefined,
    };
  }

  // --- Text / code / barcode / URL path ------------------------------------
  const text = (input.text ?? '').trim();
  if (!text) return { source: 'empty', outcome: 'none', candidates: [] };
  const r = await resolveProductsFromText(db, text, limit);
  return {
    source: 'text',
    outcome: r.outcome,
    candidates: r.hits,
    parsed: mode === 'admin' ? (r.parsed as Record<string, unknown>) : undefined,
    timingMs: mode === 'admin' ? Date.now() - started : undefined,
  };
}
