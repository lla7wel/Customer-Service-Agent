import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest, notFound } from '@/lib/api';
import { audit } from '@/lib/auth';
import { generateContentAssets } from '@integrations/pipelines/content-create';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Generate the item's assets (deterministic composition + one editable
 * Gemini phrase/caption suggestion). Draft → generating → ready | failed.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ contentId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  const { contentId } = await props.params;

  const item = await db.selectFrom('content_items').select(['id', 'status']).where('id', '=', contentId).executeTakeFirst();
  if (!item) return notFound();
  if (!['draft', 'ready', 'failed'].includes(item.status)) {
    return badRequest('not_generatable', `Items in status "${item.status}" cannot be regenerated.`);
  }

  await db.updateTable('content_items').set({ status: 'generating', last_error: null }).where('id', '=', contentId).execute();
  try {
    const result = await generateContentAssets(db, contentId);
    if (!result.ok) {
      await db.updateTable('content_items')
        .set({ status: 'draft', last_error: result.problems.join('; ').slice(0, 500) })
        .where('id', '=', contentId).execute();
      return NextResponse.json({ ok: false, problems: result.problems }, { status: 422 });
    }
    await audit(db, admin, 'content.generate', { type: 'content_item', id: contentId, detail: { assets: result.assets } });
    return NextResponse.json({ ok: true, assets: result.assets, phrase: result.phrase, caption: result.caption, problems: result.problems });
  } catch (e: any) {
    await db.updateTable('content_items')
      .set({ status: 'failed', last_error: String(e?.message ?? 'generation failed').slice(0, 500) })
      .where('id', '=', contentId).execute();
    return NextResponse.json({ ok: false, error: String(e?.message ?? 'generation failed') }, { status: 500 });
  }
}
