/**
 * Reject a catalog match suggestion — sets state = 'rejected'.
 * Rejection is preserved across matcher re-runs (admin decision wins).
 * Called by: components/catalog/CatalogMatch.tsx (reject button).
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@integrations/supabase/admin-client';
import { supabaseStatus } from '@integrations/status';

export const runtime = 'nodejs';

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

function appendRejection(raw: unknown, scraperProductId: string, reason: string | null) {
  const obj = asRecord(raw);
  const existing = Array.isArray(obj.catalog_match_rejected)
    ? (obj.catalog_match_rejected as unknown[])
    : [];
  const filtered = existing.filter((x) => {
    if (!x || typeof x !== 'object') return true;
    return (x as { scraper_product_id?: unknown }).scraper_product_id !== scraperProductId;
  });
  return {
    ...obj,
    catalog_match_rejected: [
      {
        scraper_product_id: scraperProductId,
        rejected_at: new Date().toISOString(),
        reason,
      },
      ...filtered,
    ].slice(0, 80),
  };
}

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
  const reason = typeof body?.reason === 'string' ? body.reason : null;
  if (!csvId || !scraperId || csvId === scraperId) {
    return NextResponse.json({ error: 'invalid_ids' }, { status: 400 });
  }

  const { data: csv, error: csvErr } = await db
    .from('products')
    .select('id, source, raw')
    .eq('id', csvId)
    .maybeSingle();
  if (csvErr) return NextResponse.json({ error: csvErr.message }, { status: 500 });
  if (!csv) return NextResponse.json({ error: 'csv_not_found' }, { status: 404 });
  if (csv.source !== 'csv') return NextResponse.json({ error: 'target_is_not_csv_product' }, { status: 400 });

  const { error: updateErr } = await db
    .from('products')
    .update({ raw: appendRejection(csv.raw, scraperId, reason) })
    .eq('id', csvId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Persist the rejection in the suggestions table (a later refresh re-evaluates
  // this CSV product and may surface a different candidate).
  await db
    .from('catalog_match_suggestions')
    .upsert(
      {
        csv_product_id: csvId,
        scraper_product_id: scraperId,
        state: 'rejected',
        reviewed_at: new Date().toISOString(),
        evidence: { reason },
      },
      { onConflict: 'csv_product_id' },
    );

  await db.from('activity_logs').insert({
    actor_type: 'human',
    action: 'catalog_image_match_rejected',
    entity_type: 'product',
    entity_id: csvId,
    summary: `Rejected scraped product ${scraperId} as an image source for CSV product ${csvId}`,
    meta: { csv_product_id: csvId, scraper_product_id: scraperId, reason },
  });

  return NextResponse.json({ ok: true });
}
