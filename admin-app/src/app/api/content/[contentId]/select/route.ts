import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest, notFound } from '@/lib/api';
import { audit } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Select a preserved generation revision as the only publishable output. */
export async function POST(req: NextRequest, props: { params: Promise<{ contentId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  const { contentId } = await props.params;
  const body = await req.json().catch(() => ({}));
  const runId = typeof body?.generation_run_id === 'string' ? body.generation_run_id : '';
  if (!runId) return badRequest('missing_generation_run');
  const item = await db.selectFrom('content_items').select(['id', 'config_revision', 'status']).where('id', '=', contentId).executeTakeFirst();
  if (!item) return notFound();
  if (!['draft', 'ready', 'failed'].includes(item.status)) return badRequest('not_editable');
  const run = await db.selectFrom('content_generation_runs').select(['id', 'status', 'config_revision'])
    .where('id', '=', runId).where('content_item_id', '=', contentId).executeTakeFirst();
  if (!run || run.status !== 'completed') return badRequest('generation_not_ready');
  if (run.config_revision !== item.config_revision) return badRequest('stale_generation', 'This visual belongs to an older configuration.');
  const count = await db.selectFrom('content_assets').select(db.fn.countAll<number>().as('n'))
    .where('generation_run_id', '=', runId).where('asset_role', '=', 'output').executeTakeFirst();
  if (!Number(count?.n ?? 0)) return badRequest('generation_has_no_output');
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('content_assets').set({ selected_for_publish: false })
      .where('content_item_id', '=', contentId).where('asset_role', '=', 'output').execute();
    await trx.updateTable('content_assets').set({ selected_for_publish: true })
      .where('generation_run_id', '=', runId).where('asset_role', '=', 'output').execute();
    await trx.updateTable('content_items').set({ selected_generation_run_id: runId, status: 'ready' })
      .where('id', '=', contentId).execute();
  });
  await audit(db, admin, 'content.select_generation', { type: 'content_item', id: contentId, detail: { generation_run_id: runId } });
  return NextResponse.json({ ok: true });
}
