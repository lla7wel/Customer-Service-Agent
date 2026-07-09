/**
 * Mark a catalog match suggestion state — sets state to 'needs_review' or 'no_match'.
 * Like reject, admin-set states survive matcher re-runs.
 * Called by: components/catalog/CatalogMatch.tsx (needs-review / no-match buttons).
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@integrations/supabase/admin-client';
import { supabaseStatus } from '@integrations/status';

export const runtime = 'nodejs';

const ALLOWED = ['no_match', 'needs_review', 'possible'] as const;
type MarkState = (typeof ALLOWED)[number];

/**
 * Admin sets a review state on a CSV product's match row without attaching an
 * image: "no safe match yet" (no_match), "park for later" (needs_review), or
 * reopen (possible). Admin-confirmed no_match/needs_review survive refresh.
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
  const state = body?.state as MarkState;
  if (!csvId || !ALLOWED.includes(state)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const { error } = await db
    .from('catalog_match_suggestions')
    .upsert(
      {
        csv_product_id: csvId,
        state,
        reviewed_at: new Date().toISOString(),
        evidence: { admin_confirmed: state !== 'possible' },
      },
      { onConflict: 'csv_product_id' },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from('activity_logs').insert({
    actor_type: 'human',
    action: 'catalog_image_match_marked',
    entity_type: 'product',
    entity_id: csvId,
    summary: `Marked CSV product ${csvId} match state = ${state}`,
    meta: { csv_product_id: csvId, state },
  });

  return NextResponse.json({ ok: true });
}
