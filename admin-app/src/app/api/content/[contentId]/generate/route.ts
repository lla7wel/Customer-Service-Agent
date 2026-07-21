import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest, notFound } from '@/lib/api';
import { audit } from '@/lib/auth';
import { generationFingerprint } from '@integrations/pipelines/content-create';
import { enqueue } from '@integrations/jobs/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Enqueue durable premium creative generation and return immediately. */
export async function POST(req: NextRequest, props: { params: Promise<{ contentId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  const { contentId } = await props.params;

  const item = await db.selectFrom('content_items').select(['id', 'status', 'config_revision', 'image_text_mode', 'image_text', 'image_text_approved', 'multi_product_layout']).where('id', '=', contentId).executeTakeFirst();
  if (!item) return notFound();
  if (!['draft', 'ready', 'failed'].includes(item.status)) {
    return badRequest('not_generatable', `Items in status "${item.status}" cannot be regenerated.`);
  }

  if (item.image_text_mode !== 'none' && !item.image_text?.trim()) {
    return badRequest('missing_image_text', 'Enter the image phrase before creating the visual.');
  }
  if (item.image_text_mode !== 'none' && !item.image_text_approved) {
    return badRequest('image_text_not_approved', 'Review and approve the image phrase before creating the visual.');
  }
  if (item.multi_product_layout === 'composition') {
    const [products, sources] = await Promise.all([
      db.selectFrom('content_products').select(db.fn.countAll<number>().as('n')).where('content_item_id', '=', contentId).executeTakeFirst(),
      db.selectFrom('content_assets').select(db.fn.countAll<number>().as('n')).where('content_item_id', '=', contentId).where('asset_role', '=', 'source').executeTakeFirst(),
    ]);
    if (Number(products?.n ?? 0) + Number(sources?.n ?? 0) > 4) {
      return badRequest('composition_source_limit', 'One Composition supports up to four selected products or source images.');
    }
  }
  const active = await db.selectFrom('content_generation_runs').select(['id', 'status', 'stage'])
    .where('content_item_id', '=', contentId).where('status', 'in', ['queued', 'running'])
    .orderBy('created_at', 'desc').executeTakeFirst();
  if (active) return NextResponse.json({ ok: true, run: active, deduped: true }, { status: 202 });

  const fingerprint = await generationFingerprint(db, contentId);
  const run = await db.insertInto('content_generation_runs').values({
    content_item_id: contentId,
    config_revision: item.config_revision,
    config_fingerprint: fingerprint,
    created_by: admin.id === '00000000-0000-0000-0000-000000000000' ? null : admin.id,
  }).returningAll().executeTakeFirstOrThrow();
  await db.updateTable('content_items').set({ status: 'generating', last_error: null }).where('id', '=', contentId).execute();
  await enqueue(db, {
    jobType: 'content_generate', payload: { generationRunId: run.id },
    dedupeKey: `content_generate:${contentId}`, maxAttempts: 3, priority: 40,
  });
  await audit(db, admin, 'content.generate_queued', { type: 'content_item', id: contentId, detail: { generation_run_id: run.id } });
  return NextResponse.json({ ok: true, run }, { status: 202 });
}
