/**
 * Re-run the catalog image matcher — calls refreshSuggestions() which scores
 * all scraper products against CSV products missing images, then upserts results
 * into catalog_match_suggestions. Can be slow on large catalogs.
 * Called by: components/catalog/CatalogMatch.tsx (refresh button).
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@integrations/supabase/admin-client';
import { supabaseStatus } from '@integrations/status';
import { refreshSuggestions } from '@/lib/catalog-match-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The matcher scores thousands of CSV targets × scraper candidates — give it room.
export const maxDuration = 300;

/**
 * Recompute catalog match suggestions and persist them into
 * catalog_match_suggestions. Does NOT attach any image — it only writes review
 * rows ('possible' / 'no_match'), preserving admin decisions. Pass
 * { dryRun: true } to preview counts without writing.
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
  const dryRun = body?.dryRun === true;

  try {
    const result = await refreshSuggestions(db, { dryRun });
    if (!dryRun) {
      await db.from('activity_logs').insert({
        actor_type: 'human',
        action: 'catalog_match_suggestions_refreshed',
        entity_type: 'product',
        summary: `Refreshed match suggestions: ${result.possible} possible, ${result.noMatch} no-match, ${result.preserved} preserved.`,
        meta: result as unknown as Record<string, unknown>,
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'refresh_failed' }, { status: 500 });
  }
}
