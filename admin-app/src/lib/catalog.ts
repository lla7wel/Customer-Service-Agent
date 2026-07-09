/**
 * Catalog statistics for the dashboard and catalog-review pages.
 * getCatalogStats() aggregates counts across products, product_images,
 * catalog_match_suggestions, and import_runs. SERVER ONLY.
 * Called by: dashboard page, price-review page.
 * Must not: write to the DB or trigger any mutations.
 */
import 'server-only';
import { getDb } from './supabase/db';

export interface CatalogStats {
  connected: boolean;
  products: number;
  csvProducts: number; // from the CSV catalog (source = 'csv')
  activeProducts: number; // status = active (priced, customer-visible)
  activeWithImages: number; // active AND has scraped images attached
  activeMissingImages: number; // active but no images yet
  needsReview: number; // scraped-only, no price → review/staging
  // Catalog image-match review states (catalog_match_suggestions).
  matchPossible: number; // possible matches awaiting an admin decision
  matchApproved: number; // approved + attached
  matchRejected: number; // admin-rejected candidates
  matchNoSafe: number; // no safe match found
  matchNeedsReview: number; // parked for later review
  productImages: number; // product_images rows
  uploadedImages: number; // images pushed to Storage (public_url ready)
  missingUploadedImages: number; // image rows not yet uploaded
  latestImport: {
    status: string;
    source: string | null;
    created_count: number;
    updated_count: number;
    error_count: number;
    started_at: string | null;
    finished_at: string | null;
    source_file: string | null;
  } | null;
}

const EMPTY: CatalogStats = {
  connected: false,
  products: 0,
  csvProducts: 0,
  activeProducts: 0,
  activeWithImages: 0,
  activeMissingImages: 0,
  needsReview: 0,
  matchPossible: 0,
  matchApproved: 0,
  matchRejected: 0,
  matchNoSafe: 0,
  matchNeedsReview: 0,
  productImages: 0,
  uploadedImages: 0,
  missingUploadedImages: 0,
  latestImport: null,
};

async function headCount(
  db: NonNullable<ReturnType<typeof getDb>>,
  table: string,
  build?: (q: any) => any,
): Promise<number> {
  let q: any = db.selectFrom(table as any);
  if (build) q = build(q);
  const row = await q.select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst();
  return Number(row?.n ?? 0);
}

/** Diagnostic counts for the catalog (used by dashboard, price-review, sync). */
export async function getCatalogStats(): Promise<CatalogStats> {
  const db = getDb();
  if (!db) return EMPTY;

  const [
    products,
    csvProducts,
    activeProducts,
    activeWithImages,
    activeMissingImages,
    needsReview,
    matchPossible,
    matchApproved,
    matchRejected,
    matchNoSafe,
    matchNeedsReview,
    productImages,
    uploadedImages,
    importRes,
  ] = await Promise.all([
    headCount(db, 'products'),
    headCount(db, 'products', (q) => q.where('source', '=', 'csv')),
    headCount(db, 'products', (q) => q.where('status', '=', 'active')),
    headCount(db, 'products', (q) => q.where('status', '=', 'active').where('primary_image_id', 'is not', null)),
    headCount(db, 'products', (q) => q.where('status', '=', 'active').where('primary_image_id', 'is', null)),
    headCount(db, 'products', (q) => q.where('base_price', 'is', null)),
    headCount(db, 'catalog_match_suggestions', (q) => q.where('state', '=', 'possible')),
    headCount(db, 'catalog_match_suggestions', (q) => q.where('state', '=', 'approved')),
    headCount(db, 'catalog_match_suggestions', (q) => q.where('state', '=', 'rejected')),
    headCount(db, 'catalog_match_suggestions', (q) => q.where('state', '=', 'no_match')),
    headCount(db, 'catalog_match_suggestions', (q) => q.where('state', '=', 'needs_review')),
    headCount(db, 'product_images'),
    headCount(db, 'product_images', (q) => q.where('storage_path', 'is not', null)),
    db
      .selectFrom('product_import_runs')
      .select(['status', 'source', 'created_count', 'updated_count', 'error_count', 'started_at', 'finished_at', 'source_file'])
      .orderBy('started_at', 'desc')
      .limit(1)
      .executeTakeFirst(),
  ]);

  return {
    connected: true,
    products,
    csvProducts,
    activeProducts,
    activeWithImages,
    activeMissingImages,
    needsReview,
    matchPossible,
    matchApproved,
    matchRejected,
    matchNoSafe,
    matchNeedsReview,
    productImages,
    uploadedImages,
    missingUploadedImages: Math.max(0, productImages - uploadedImages),
    latestImport: (importRes as CatalogStats['latestImport']) ?? null,
  };
}
