/**
 * UI-layer product row helpers used by catalog and inbox components.
 * toUiCandidate() shapes a raw products row into a UiCandidate.
 * uiProductQuery() is the canonical product select (with embedded images) for
 * the admin app — keeps join paths and column lists consistent.
 * Called by: catalog-match components, inbox components, product pages.
 * Must not: contain business logic or DB writes.
 */
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { DB, Kysely } from '@integrations/db/client';
import {
  customerProductName,
  originalProductName,
  primaryProductImageUrl,
} from '@integrations/util/product-display';

export interface UiCandidate {
  id: string;
  product_code: string | null;
  name: string;
  original_name?: string | null;
  price: number | null;
  image: string | null;
  website_url?: string | null;
  confidence?: number;
  reason?: string | null;
}

const PRODUCT_COLS = [
  'id', 'product_code', 'libyan_display_name', 'arabic_name', 'english_name', 'source_name',
  'active_price', 'base_price', 'website_url', 'category', 'arabic_keywords',
] as const;

/** Canonical admin product select: shared columns + embedded images array. */
export function uiProductQuery(db: Kysely<DB>) {
  return db
    .selectFrom('products')
    .select(PRODUCT_COLS.map((c) => `products.${c}` as const))
    .select((eb) => [
      jsonArrayFrom(
        eb.selectFrom('product_images')
          .select(['public_url', 'storage_path', 'is_primary', 'position'])
          .whereRef('product_images.product_id', '=', 'products.id')
          .orderBy('position', 'asc'),
      ).as('product_images'),
    ]);
}

export function toUiCandidate(product: any, raw: Partial<UiCandidate> = {}): UiCandidate {
  return {
    id: product.id,
    product_code: product.product_code ?? raw.product_code ?? null,
    name: customerProductName(product),
    original_name: originalProductName(product),
    price: product.active_price ?? product.base_price ?? raw.price ?? null,
    image: primaryProductImageUrl(product) ?? raw.image ?? null,
    website_url: product.website_url ?? raw.website_url ?? null,
    confidence: raw.confidence,
    reason: raw.reason ?? null,
  };
}

export async function hydrateUiCandidates(db: Kysely<DB>, candidates: any[]): Promise<UiCandidate[]> {
  const raw = (Array.isArray(candidates) ? candidates : []).filter((c) => c?.id);
  if (!raw.length) return [];
  const ids = Array.from(new Set(raw.map((c) => String(c.id))));
  const data = await uiProductQuery(db).where('products.id', 'in', ids).execute();
  const byId = new Map(data.map((p: any) => [p.id, p]));
  return raw.map((c) => {
    const product = byId.get(String(c.id));
    if (product) return toUiCandidate(product, c);
    return {
      id: String(c.id),
      product_code: c.product_code ?? null,
      name: customerProductName(c),
      original_name: originalProductName(c),
      price: c.price ?? null,
      image: c.image ?? null,
      website_url: c.website_url ?? null,
      confidence: typeof c.confidence === 'number' ? c.confidence : undefined,
      reason: c.reason ?? null,
    };
  });
}

export async function hydrateMessagesWithCandidates(db: Kysely<DB>, messages: any[]): Promise<any[]> {
  const out = [...(messages ?? [])];
  const metas = out
    .map((m) => m?.ai_meta)
    .filter((meta) => Array.isArray(meta?.candidates) && meta.candidates.length);
  if (!metas.length) return out;

  const ids = Array.from(new Set(metas.flatMap((meta) => meta.candidates.map((c: any) => c?.id).filter(Boolean).map(String))));
  if (!ids.length) return out;
  const data = await uiProductQuery(db).where('products.id', 'in', ids).execute();
  const byId = new Map(data.map((p: any) => [p.id, p]));

  return out.map((m) => {
    const candidates = m?.ai_meta?.candidates;
    if (!Array.isArray(candidates) || !candidates.length) return m;
    const hydrated = candidates.map((c: any) => {
      const product = byId.get(String(c.id));
      return product ? toUiCandidate(product, c) : c;
    });
    return { ...m, ai_meta: { ...(m.ai_meta ?? {}), candidates: hydrated } };
  });
}
