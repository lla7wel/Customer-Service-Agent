/**
 * Catalog match suggestion list — GET returns a paginated list of suggestions
 * filtered by state. Called by: components/catalog/CatalogMatch.tsx.
 * Related action routes: /approve, /reject, /mark, /refresh.
 * Reads: catalog_match_suggestions (via lib/catalog-match-store).
 */
import { NextRequest, NextResponse } from 'next/server';
import { unstable_noStore as noStore } from 'next/cache';
import { getDb } from '@/lib/supabase/db';
import { supabaseStatus } from '@integrations/status';
import { countByState } from '@/lib/catalog-match-store';
import type { CatalogMatchState } from '@integrations/supabase/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE = 18;
const STATES: CatalogMatchState[] = ['possible', 'approved', 'rejected', 'no_match', 'needs_review'];

type Db = NonNullable<ReturnType<typeof getDb>>;

async function headCount(db: Db, table: string, build?: (q: any) => any): Promise<number> {
  let q: any = db.from(table).select('id', { count: 'exact', head: true });
  if (build) q = build(q);
  const { count } = await q;
  return count ?? 0;
}

/**
 * Read persisted catalog match suggestions for one review state, joined with the
 * CSV product and the suggested scraper product's image/name. Suggestions are
 * produced by POST /api/catalog-match/refresh (the matcher), not recomputed here.
 */
export async function GET(req: NextRequest) {
  noStore();
  if (!supabaseStatus().configured) {
    return NextResponse.json({ error: 'integration_not_configured' }, { status: 503 });
  }
  const db = getDb();
  if (!db) return NextResponse.json({ rows: [], total: 0 });

  const page = Math.max(0, parseInt(req.nextUrl.searchParams.get('page') ?? '0', 10) || 0);
  const stateParam = req.nextUrl.searchParams.get('state') as CatalogMatchState | null;
  const state: CatalogMatchState = stateParam && STATES.includes(stateParam) ? stateParam : 'possible';
  const confidence = req.nextUrl.searchParams.get('confidence'); // optional, for 'possible'

  // 1) Page of suggestion rows for this state.
  let sugQ: any = db
    .from('catalog_match_suggestions')
    .select('id, csv_product_id, scraper_product_id, score, confidence, evidence, state, reviewed_at', { count: 'exact' })
    .eq('state', state);
  if (state === 'possible' && confidence && ['high', 'medium', 'low'].includes(confidence)) {
    sugQ = sugQ.eq('confidence', confidence);
  }
  const { data: sugs, count, error: sugErr } = await sugQ
    .order('score', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1);
  if (sugErr) return NextResponse.json({ error: sugErr.message }, { status: 500 });

  const suggestions = (sugs ?? []) as any[];
  const csvIds = suggestions.map((s) => s.csv_product_id);
  const scraperIds = suggestions.map((s) => s.scraper_product_id).filter(Boolean) as string[];

  // 2) Fetch the CSV products for this page.
  const csvById = new Map<string, any>();
  if (csvIds.length) {
    const { data: csvRows } = await db
      .from('products')
      .select('id, english_name, arabic_name, libyan_display_name, product_code, barcode, category, search_keywords, arabic_keywords, base_price')
      .in('id', csvIds);
    for (const p of (csvRows ?? []) as any[]) csvById.set(p.id, p);
  }

  // 3) Fetch the suggested scraper products + a primary image (fills backfilled
  //    rows whose evidence lacks image/source_name).
  const scraperById = new Map<string, any>();
  if (scraperIds.length) {
    const { data: scr } = await db
      .from('products')
      .select('id, source_name, product_images!product_images_product_id_fkey(public_url,is_primary,position)')
      .in('id', scraperIds);
    for (const p of (scr ?? []) as any[]) {
      const imgs = p.product_images ?? [];
      const primary = imgs.find((i: any) => i.is_primary) ?? imgs.find((i: any) => i.public_url) ?? imgs[0];
      scraperById.set(p.id, { source_name: p.source_name, image: primary?.public_url ?? null, image_count: imgs.length });
    }
  }

  const rows = suggestions.map((s) => {
    const csv = csvById.get(s.csv_product_id) ?? {};
    const ev = (s.evidence ?? {}) as Record<string, any>;
    const scr = s.scraper_product_id ? scraperById.get(s.scraper_product_id) : null;
    const suggestion = s.scraper_product_id
      ? {
          scraper_product_id: s.scraper_product_id,
          source_name: ev.source_name ?? scr?.source_name ?? null,
          image: ev.image ?? scr?.image ?? null,
          image_count: ev.image_count ?? scr?.image_count ?? 0,
          confidence: typeof ev.confidence === 'number' ? ev.confidence : null,
          level: (s.confidence ?? 'none') as 'high' | 'medium' | 'low' | 'none',
          shared: Array.isArray(ev.shared) ? ev.shared : [],
          reason: ev.reason ?? '',
        }
      : null;
    return {
      id: s.csv_product_id,
      suggestionId: s.id,
      state: s.state as CatalogMatchState,
      name: csv.libyan_display_name || csv.arabic_name || csv.english_name || csv.product_code || s.csv_product_id,
      english_name: csv.english_name ?? null,
      arabic_name: csv.arabic_name ?? null,
      libyan_display_name: csv.libyan_display_name ?? null,
      product_code: csv.product_code ?? null,
      barcode: csv.barcode ?? null,
      category: csv.category ?? null,
      search_keywords: csv.search_keywords ?? [],
      arabic_keywords: csv.arabic_keywords ?? [],
      price: csv.base_price ?? null,
      suggestion,
    };
  });

  // 4) Counts: per state + the live product context.
  const [byState, activeCsvMissingImages, scraperOnlyReviewRemaining] = await Promise.all([
    countByState(db),
    headCount(db, 'products', (q) =>
      q.eq('source', 'csv').eq('status', 'active').not('base_price', 'is', null).is('primary_image_id', null),
    ),
    headCount(db, 'products', (q) => q.eq('source', 'scraper').neq('status', 'archived').is('base_price', null)),
  ]);

  return NextResponse.json({
    rows,
    total: count ?? 0,
    page,
    pageSize: PAGE,
    state,
    confidence: confidence ?? null,
    counts: { ...byState, activeCsvMissingImages, scraperOnlyReviewRemaining },
  });
}
