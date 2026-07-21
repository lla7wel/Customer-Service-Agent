import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest, notFound } from '@/lib/api';
import { audit } from '@/lib/auth';
import { tripoliLocalToUtc } from '@/lib/tripoli-time';
import { startPublishing } from '@integrations/pipelines/content-publish';
import { validateSelectedGeneration } from '@integrations/content/approval';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Approval — the final admin action.
 *   { when: 'now' }                          → publish immediately
 *   { when: 'schedule', local: 'YYYY-MM-DDTHH:mm' } → Africa/Tripoli schedule
 *
 * Validations: assets exist, platforms chosen, and a price drop has a new
 * price for every selected product. Price activation happens only when the
 * first platform actually publishes (worker-side).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ contentId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  const { contentId } = await props.params;
  const body = await req.json().catch(() => ({}));
  const when = body?.when === 'schedule' ? 'schedule' : 'now';

  const item = await db.selectFrom('content_items').selectAll().where('id', '=', contentId).executeTakeFirst();
  if (!item) return notFound();
  if (!['ready', 'scheduled', 'failed', 'partially_published'].includes(item.status)) {
    return badRequest('not_approvable', `Items in status "${item.status}" cannot be approved.`);
  }
  if (!(item.platforms ?? []).length) return badRequest('missing_platforms');

  const selectedRun = item.selected_generation_run_id
    ? await db.selectFrom('content_generation_runs').select(['id', 'status', 'quality_status', 'config_revision'])
      .where('id', '=', item.selected_generation_run_id).where('content_item_id', '=', contentId).executeTakeFirst()
    : null;
  const generationIssue = validateSelectedGeneration({
    selectedGenerationId: item.selected_generation_run_id,
    itemRevision: item.config_revision,
    run: selectedRun,
    warningAcknowledged: body?.acknowledge_quality_warning === true,
  });
  if (generationIssue === 'no_selected_generation') return badRequest(generationIssue, 'Select a current generated visual first.');
  if (generationIssue === 'stale_generation') return badRequest(generationIssue, 'The selected visual is stale. Generate again before publishing.');
  if (generationIssue === 'quality_warning_ack_required') return badRequest(generationIssue, 'Review and acknowledge the visual quality warning before publishing.');
  const assetCount = await db.selectFrom('content_assets')
    .select(db.fn.countAll<number>().as('n'))
    .where('content_item_id', '=', contentId)
    .where('asset_role', '=', 'output')
    .where('selected_for_publish', '=', true)
    .where('config_revision', '=', item.config_revision)
    .executeTakeFirst();
  if (!Number(assetCount?.n ?? 0)) return badRequest('no_assets', 'Generate or upload the visuals first.');

  if (item.purpose === 'price_drop') {
    const products = await db.selectFrom('content_products')
      .select(['product_id', 'new_price'])
      .where('content_item_id', '=', contentId)
      .execute();
    if (!products.length) return badRequest('no_products', 'A price drop requires selected products.');
    if (products.some((p) => p.new_price == null || !(Number(p.new_price) > 0))) {
      return badRequest('missing_new_price', 'Every selected product needs its new price.');
    }
    // Overlapping-promotion guard, surfaced at approval instead of at publish.
    for (const p of products) {
      const open = await db.selectFrom('promotions')
        .select('id')
        .where('product_id', '=', p.product_id)
        .where('status', 'in', ['pending', 'active'])
        .where((eb) => eb.or([
          eb('content_item_id', 'is', null),
          eb('content_item_id', '!=', contentId),
        ]))
        .executeTakeFirst();
      if (open) {
        return badRequest('promotion_conflict', 'A selected product already has an open promotion. End it first.');
      }
    }
  }

  if (when === 'schedule') {
    const local = typeof body?.local === 'string' ? body.local : '';
    const utc = tripoliLocalToUtc(local);
    if (!utc) return badRequest('invalid_schedule', 'Send local as YYYY-MM-DDTHH:mm (Africa/Tripoli).');
    if (new Date(utc).getTime() < Date.now() + 60_000) {
      return badRequest('schedule_in_past', 'The scheduled time must be in the future.');
    }
    await db.updateTable('content_items')
      .set({
        status: 'scheduled',
        scheduled_for: utc,
        approved_by: admin.id === '00000000-0000-0000-0000-000000000000' ? null : admin.id,
        approved_at: new Date().toISOString(),
      })
      .where('id', '=', contentId).execute();
    await audit(db, admin, 'content.approve_scheduled', { type: 'content_item', id: contentId, detail: { scheduled_for: utc } });
    return NextResponse.json({ ok: true, status: 'scheduled', scheduled_for: utc });
  }

  await db.updateTable('content_items')
    .set({
      status: 'approved',
      scheduled_for: null,
      approved_by: admin.id === '00000000-0000-0000-0000-000000000000' ? null : admin.id,
      approved_at: new Date().toISOString(),
    })
    .where('id', '=', contentId).execute();
  const started = await startPublishing(db, contentId);
  await audit(db, admin, 'content.approve_now', { type: 'content_item', id: contentId, detail: { publications: started.publicationIds.length } });
  return NextResponse.json({ ok: true, status: 'publishing', publications: started.publicationIds.length });
}
