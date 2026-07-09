/**
 * Bulk approve catalog match suggestions in the 'possible' state. Safe + honest:
 * approves only valid possible matches, SKIPS conflicts (CSV already imaged,
 * source archived, no images, etc.) and reports the exact approved/skipped
 * counts with per-skip reasons. Never silently fails.
 *
 * Body: { confidence?: 'high'|'medium'|'low', ids?: string[], limit?: number }
 *  - confidence: only approve possibles of this confidence (recommended: 'high')
 *  - ids: explicit suggestion ids to approve (overrides confidence selection)
 *  - limit: cap how many to process this call (default 200, max 500)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@integrations/db/client';
import { databaseStatus } from '@integrations/status';
import { approveOne } from '@/lib/catalog-approve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'integration_not_configured', missing: databaseStatus().missing },
      { status: 503 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const confidence = typeof body?.confidence === 'string' && ['high', 'medium', 'low'].includes(body.confidence) ? body.confidence : null;
  const ids: string[] | null = Array.isArray(body?.ids) && body.ids.length ? body.ids.map(String) : null;
  const limit = Math.min(500, Math.max(1, parseInt(String(body?.limit ?? 200), 10) || 200));

  // SAFETY: never blanket-approve every possible match. The caller MUST scope the
  // batch by an explicit confidence band or an explicit id list. This prevents an
  // accidental "approve everything (incl. low confidence)" call.
  if (!confidence && !ids) {
    return NextResponse.json(
      { error: 'scope_required', hint: 'Provide { confidence: "high"|"medium"|"low" } or { ids: [...] }. Refusing to bulk-approve all possible matches.' },
      { status: 400 },
    );
  }

  let q = db
    .selectFrom('catalog_match_suggestions')
    .select(['id', 'csv_product_id', 'scraper_product_id', 'confidence'])
    .where('state', '=', 'possible')
    .where('scraper_product_id', 'is not', null);
  if (ids) q = q.where('id', 'in', ids);
  else if (confidence) q = q.where('confidence', '=', confidence);
  let candidates: { id: string; csv_product_id: string; scraper_product_id: string | null }[];
  try {
    candidates = await q.orderBy('score', (ob) => ob.desc().nullsLast()).limit(limit).execute();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'query_failed' }, { status: 500 });
  }
  let approved = 0;
  const skipped: { id: string; reason: string }[] = [];
  // Time budget so a big batch never exceeds maxDuration.
  const startedAt = Date.now();
  for (const row of candidates) {
    if (Date.now() - startedAt > 100_000) { skipped.push({ id: row.id, reason: 'time_budget' }); continue; }
    if (!row.scraper_product_id) { skipped.push({ id: row.id, reason: 'no_scraper' }); continue; }
    const r = await approveOne(db, row.csv_product_id, row.scraper_product_id, 'bulk_approve');
    if (r.ok) approved++;
    else skipped.push({ id: row.id, reason: r.reason ?? 'unknown' });
  }

  return NextResponse.json({
    ok: true,
    selected: candidates.length,
    approved,
    skipped: skipped.length,
    skip_reasons: skipped.slice(0, 50),
  });
}
