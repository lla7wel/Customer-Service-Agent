/**
 * Shared contracts for the controlled AI tools layer.
 *
 * ProductCandidate is the ONE product shape used across retrieval, ranking, the
 * pipelines, the inbox UI and the Playground. Its `name`/`price` are always
 * catalog-safe (customerProductName + active_price) — Turkish source_name is
 * never the customer-facing name, and price is never invented.
 */

export type RetrievalTrack =
  | 'exact_code'
  | 'exact_barcode'
  | 'exact_url'
  | 'correction_memory'
  | 'hash_near_dup'
  | 'hash_similar'
  | 'vector_text'
  | 'text_search';

export interface ProductCandidate {
  id: string;
  product_code: string | null;
  barcode?: string | null;
  name: string;                 // customerProductName() — never source_name
  original_name?: string | null;
  price: number | null;         // active_price only
  image: string | null;
  website_url: string | null;
  confidence: number;           // 0..1
  reason?: string | null;
  /** Which retrieval signals produced/contributed this candidate (diagnostics). */
  retrieval_tracks?: RetrievalTrack[];
}

export type ToolResult<T> = { ok: true; data: T } | { ok: false; reason: string };

/** SELECT column list shared by every product tool (keeps shapes identical). */
export const PRODUCT_COLUMNS =
  'id, product_code, barcode, libyan_display_name, arabic_name, english_name, source_name, ' +
  'category, subcategory, active_price, status, website_url, search_keywords, arabic_keywords, ' +
  'product_images!product_images_product_id_fkey(public_url,storage_path,is_primary,position,perceptual_hash)';
