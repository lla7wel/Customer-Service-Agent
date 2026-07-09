/**
 * Reject a catalog match suggestion — sets state = 'rejected'.
 * Rejection is preserved across matcher re-runs (admin decision wins).
 * Called by: components/catalog/CatalogMatch.tsx (reject button).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@integrations/db/client';
import { databaseStatus } from '@integrations/status';

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
  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'integration_not_configured', missing: databaseStatus().missing },
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

  const csv = await db
    .selectFrom('products')
    .select(['id', 'source', 'raw'])
    .where('id', '=', csvId)
    .executeTakeFirst();
  if (!csv) return NextResponse.json({ error: 'csv_not_found' }, { status: 404 });
  if (csv.source !== 'csv') return NextResponse.json({ error: 'target_is_not_csv_product' }, { status: 400 });

  try {
    await db
      .updateTable('products')
      .set({ raw: JSON.stringify(appendRejection(csv.raw, scraperId, reason)) })
      .where('id', '=', csvId).execute();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'update_failed' }, { status: 500 });
  }

  // Persist the rejection in the suggestions table (a later refresh re-evaluates
  // this CSV product and may surface a different candidate).
  await db
    .insertInto('catalog_match_suggestions')
    .values({
      csv_product_id: csvId,
      scraper_product_id: scraperId,
      state: 'rejected',
      reviewed_at: new Date().toISOString(),
      evidence: JSON.stringify({ reason }),
    })
    .onConflict((oc) => oc.column('csv_product_id').doUpdateSet({
      scraper_product_id: (eb) => eb.ref('excluded.scraper_product_id'),
      state: (eb) => eb.ref('excluded.state'),
      reviewed_at: (eb) => eb.ref('excluded.reviewed_at'),
      evidence: (eb) => eb.ref('excluded.evidence'),
    }))
    .execute();

  await db.insertInto('activity_logs').values({
    actor_type: 'human',
    action: 'catalog_image_match_rejected',
    entity_type: 'product',
    entity_id: csvId,
    summary: `Rejected scraped product ${scraperId} as an image source for CSV product ${csvId}`,
    meta: JSON.stringify({ csv_product_id: csvId, scraper_product_id: scraperId, reason }),
  }).execute();

  return NextResponse.json({ ok: true });
}
