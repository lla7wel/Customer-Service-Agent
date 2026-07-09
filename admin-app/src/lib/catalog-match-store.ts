/**
 * Server-only store for the persistent catalog match/review workflow.
 *
 * The matcher (integrations/catalog-match.ts) scores scraper products against CSV
 * products that are missing images. Instead of recomputing on every page load,
 * `refreshSuggestions` runs the matcher once and upserts one row per CSV target
 * into `catalog_match_suggestions`, with a review `state`. The UI then reads
 * those rows by state. Admin decisions (approved / admin-confirmed no_match /
 * needs_review) are preserved across refreshes — "admin edits win forever".
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  bestCatalogMatch,
  prepareMatchProduct,
  type CatalogMatchSuggestion,
} from '@integrations/catalog-match';
import type { CatalogMatchState } from '@integrations/supabase/types';

type Db = SupabaseClient;

export interface ScraperCandidate {
  id: string;
  source_name: string | null;
  product_code: string | null;
  barcode: string | null;
  category: string | null;
  image: string | null;
  image_count: number;
  raw?: unknown;
}

export interface CsvTarget {
  id: string;
  english_name: string | null;
  arabic_name: string | null;
  libyan_display_name: string | null;
  product_code: string | null;
  barcode: string | null;
  category: string | null;
  search_keywords: string[] | null;
  arabic_keywords: string[] | null;
  base_price: number | null;
  raw?: unknown;
}

const TARGET_COLUMNS =
  'id, english_name, arabic_name, libyan_display_name, product_code, barcode, category, search_keywords, arabic_keywords, base_price, raw';

/** The CSV products that need an image: active, priced, no primary image. */
export function targetQuery(db: Db, count?: 'exact') {
  const q = count
    ? db.from('products').select(TARGET_COLUMNS, { count })
    : db.from('products').select(TARGET_COLUMNS);
  return q
    .eq('source', 'csv')
    .eq('status', 'active')
    .not('base_price', 'is', null)
    .is('primary_image_id', null);
}

/** Scraper-only products that still have images and are not archived. */
export async function loadCandidates(db: Db): Promise<ScraperCandidate[]> {
  const rows: ScraperCandidate[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from('products')
      .select(
        'id, source_name, product_code, barcode, category, raw, product_images!product_images_product_id_fkey(public_url,is_primary,position)',
      )
      .eq('source', 'scraper')
      .neq('status', 'archived')
      .is('base_price', null)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as any[]) {
      const imgs = p.product_images ?? [];
      if (imgs.length === 0) continue;
      const primary = imgs.find((i: any) => i.is_primary) ?? imgs.find((i: any) => i.public_url) ?? imgs[0];
      rows.push({
        id: p.id,
        source_name: p.source_name,
        product_code: p.product_code ?? null,
        barcode: p.barcode ?? null,
        category: p.category,
        image: primary?.public_url ?? null,
        image_count: imgs.length,
        raw: p.raw,
      });
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

export async function loadAllTargets(db: Db): Promise<CsvTarget[]> {
  const rows: CsvTarget[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await targetQuery(db)
      .order('updated_at', { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as CsvTarget[]));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

interface ExistingRow {
  csv_product_id: string;
  state: CatalogMatchState;
  reviewed_by: string | null;
  evidence: Record<string, unknown> | null;
}

async function loadExisting(db: Db): Promise<Map<string, ExistingRow>> {
  const map = new Map<string, ExistingRow>();
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from('catalog_match_suggestions')
      .select('csv_product_id, state, reviewed_by, evidence')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as ExistingRow[]) map.set(r.csv_product_id, r);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return map;
}

/** A row whose state is an admin decision that refresh must never overwrite. */
function isAdminLocked(row: ExistingRow | undefined): boolean {
  if (!row) return false;
  if (row.state === 'approved') return true;
  // Admin-confirmed "no safe match" / parked-for-review are preserved; a plain
  // matcher-generated 'no_match' is free to be re-evaluated. Admin actions mark
  // the row with reviewed_by or evidence.admin_confirmed.
  if (row.state === 'no_match' || row.state === 'needs_review') {
    return !!row.reviewed_by || row.evidence?.admin_confirmed === true;
  }
  return false;
}

function evidenceOf(s: CatalogMatchSuggestion) {
  return {
    signals: s.signals,
    shared: s.shared,
    reason: s.reason,
    confidence: s.confidence,
    image: s.image,
    image_count: s.image_count,
    source_name: s.source_name,
  };
}

export interface RefreshResult {
  dryRun: boolean;
  checked: number;
  possible: number;
  noMatch: number;
  preserved: number;
  byConfidence: { high: number; medium: number; low: number };
  written: number;
}

/**
 * Run the matcher over every CSV target and upsert suggestion rows. Never writes
 * over an admin decision. With dryRun=true it only reports what would change.
 */
export async function refreshSuggestions(db: Db, opts: { dryRun?: boolean } = {}): Promise<RefreshResult> {
  const dryRun = opts.dryRun ?? false;
  const [candidates, targets, existing] = await Promise.all([
    loadCandidates(db),
    loadAllTargets(db),
    loadExisting(db),
  ]);
  const preparedCandidates = candidates.map((c) => prepareMatchProduct(c));

  const upserts: Record<string, unknown>[] = [];
  const result: RefreshResult = {
    dryRun,
    checked: targets.length,
    possible: 0,
    noMatch: 0,
    preserved: 0,
    byConfidence: { high: 0, medium: 0, low: 0 },
    written: 0,
  };

  for (const target of targets) {
    if (isAdminLocked(existing.get(target.id))) {
      result.preserved++;
      continue;
    }
    const best = bestCatalogMatch(prepareMatchProduct(target), preparedCandidates);
    if (best) {
      result.possible++;
      if (best.level === 'high') result.byConfidence.high++;
      else if (best.level === 'medium') result.byConfidence.medium++;
      else result.byConfidence.low++;
      upserts.push({
        csv_product_id: target.id,
        scraper_product_id: best.scraper_product_id,
        score: best.score,
        confidence: best.level,
        evidence: evidenceOf(best),
        state: 'possible',
        reviewed_by: null,
        reviewed_at: null,
      });
    } else {
      result.noMatch++;
      upserts.push({
        csv_product_id: target.id,
        scraper_product_id: null,
        score: null,
        confidence: 'none',
        evidence: {},
        state: 'no_match',
        reviewed_by: null,
        reviewed_at: null,
      });
    }
  }

  if (!dryRun) {
    for (let i = 0; i < upserts.length; i += 200) {
      const batch = upserts.slice(i, i + 200);
      const { error } = await db
        .from('catalog_match_suggestions')
        .upsert(batch, { onConflict: 'csv_product_id' });
      if (error) throw new Error(error.message);
      result.written += batch.length;
    }
  }

  return result;
}

/** Count suggestions grouped by review state (for filters + dashboard). */
export async function countByState(db: Db): Promise<Record<CatalogMatchState, number>> {
  const states: CatalogMatchState[] = ['possible', 'approved', 'rejected', 'no_match', 'needs_review'];
  const counts = await Promise.all(
    states.map(async (state) => {
      const { count } = await db
        .from('catalog_match_suggestions')
        .select('id', { count: 'exact', head: true })
        .eq('state', state);
      return [state, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts) as Record<CatalogMatchState, number>;
}
