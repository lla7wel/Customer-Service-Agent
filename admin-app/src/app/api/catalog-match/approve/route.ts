/**
 * Approve a catalog match suggestion — links the scraper product's images to
 * the CSV product and sets state = 'approved' in catalog_match_suggestions.
 * Called by: components/catalog/CatalogMatch.tsx (approve button).
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@integrations/supabase/admin-client';
import { supabaseStatus } from '@integrations/status';
import { approveOne } from '@/lib/catalog-approve';

export const runtime = 'nodejs';

/**
 * Approve a catalog image match: move the scraped product's images onto the CSV
 * product, then archive the now-merged scraped-only product. The CSV product
 * stays the source of truth (its Arabic/English name + price are untouched).
 * Shared logic lives in lib/catalog-approve.ts (also used by bulk approve).
 */
export async function POST(req: NextRequest) {
  const db = adminClient();
  if (!db) {
    return NextResponse.json(
      { error: 'integration_not_configured', missing: supabaseStatus().missing.concat('SUPABASE_SERVICE_ROLE_KEY') },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const csvId = body?.csvProductId as string;
  const scraperId = body?.scraperProductId as string;
  const r = await approveOne(db, csvId, scraperId);
  if (!r.ok) {
    const status = r.reason === 'csv_already_has_image' ? 409 : r.reason === 'invalid_ids' ? 400 : 400;
    return NextResponse.json({ error: r.reason }, { status });
  }
  return NextResponse.json({ ok: true, moved: r.moved });
}
