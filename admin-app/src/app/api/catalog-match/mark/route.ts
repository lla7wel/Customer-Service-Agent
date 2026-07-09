/**
 * Mark a catalog match suggestion state — sets state to 'needs_review' or 'no_match'.
 * Like reject, admin-set states survive matcher re-runs.
 * Called by: components/catalog/CatalogMatch.tsx (needs-review / no-match buttons).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@integrations/db/client';
import { databaseStatus } from '@integrations/status';

export const runtime = 'nodejs';

const ALLOWED = ['no_match', 'needs_review', 'possible'] as const;
type MarkState = (typeof ALLOWED)[number];

/**
 * Admin sets a review state on a CSV product's match row without attaching an
 * image: "no safe match yet" (no_match), "park for later" (needs_review), or
 * reopen (possible). Admin-confirmed no_match/needs_review survive refresh.
 */
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
  const state = body?.state as MarkState;
  if (!csvId || !ALLOWED.includes(state)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    await db
      .insertInto('catalog_match_suggestions')
      .values({
        csv_product_id: csvId,
        state,
        reviewed_at: new Date().toISOString(),
        evidence: JSON.stringify({ admin_confirmed: state !== 'possible' }),
      })
      .onConflict((oc) => oc.column('csv_product_id').doUpdateSet({
        state: (eb) => eb.ref('excluded.state'),
        reviewed_at: (eb) => eb.ref('excluded.reviewed_at'),
        evidence: (eb) => eb.ref('excluded.evidence'),
      }))
      .execute();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'update_failed' }, { status: 500 });
  }

  await db.insertInto('activity_logs').values({
    actor_type: 'human',
    action: 'catalog_image_match_marked',
    entity_type: 'product',
    entity_id: csvId,
    summary: `Marked CSV product ${csvId} match state = ${state}`,
    meta: JSON.stringify({ csv_product_id: csvId, state }),
  }).execute();

  return NextResponse.json({ ok: true });
}
