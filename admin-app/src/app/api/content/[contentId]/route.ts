import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest, notFound } from '@/lib/api';
import { audit } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EDITABLE_STATUSES = ['draft', 'generating', 'ready', 'failed'];

/** Full detail: item + products + assets + publications + comments. */
export async function GET(req: NextRequest, props: { params: Promise<{ contentId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db } = auth.ctx;
  const { contentId } = await props.params;

  const item = await db.selectFrom('content_items').selectAll().where('id', '=', contentId).executeTakeFirst();
  if (!item) return notFound();

  const [products, assets, publications, comments] = await Promise.all([
    db.selectFrom('content_products as cp')
      .innerJoin('products as p', 'p.id', 'cp.product_id')
      .leftJoin('product_images as pi', (join) => join.onRef('pi.product_id', '=', 'p.id').on('pi.is_primary', '=', true))
      .select(['cp.id as row_id', 'cp.product_id', 'cp.new_price', 'cp.show_price', 'cp.position',
               'p.product_code', 'p.libyan_display_name', 'p.arabic_name', 'p.english_name',
               'p.active_price', 'p.base_price', 'pi.public_url as image_url'])
      .where('cp.content_item_id', '=', contentId)
      .orderBy('cp.position', 'asc')
      .execute(),
    db.selectFrom('content_assets').selectAll().where('content_item_id', '=', contentId).orderBy('position', 'asc').execute(),
    db.selectFrom('content_publications').selectAll().where('content_item_id', '=', contentId).execute(),
    db.selectFrom('content_comments as cc')
      .innerJoin('content_publications as pub', 'pub.id', 'cc.publication_id')
      .select(['cc.id', 'cc.provider_comment_id', 'cc.author_name', 'cc.body', 'cc.commented_at',
               'cc.decision', 'cc.decision_reason', 'cc.reply_text', 'cc.reply_status', 'cc.reply_error',
               'pub.platform'])
      .where('pub.content_item_id', '=', contentId)
      .orderBy('cc.created_at', 'desc')
      .limit(100)
      .execute(),
  ]);
  return NextResponse.json({ item, products, assets, publications, comments });
}

/** Update draft/ready fields: products, prices, caption, phrase, platforms… */
export async function PATCH(req: NextRequest, props: { params: Promise<{ contentId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  const { contentId } = await props.params;
  const body = await req.json().catch(() => ({}));

  const item = await db.selectFrom('content_items').select(['id', 'status', 'purpose']).where('id', '=', contentId).executeTakeFirst();
  if (!item) return notFound();
  if (!EDITABLE_STATUSES.includes(item.status) && !body?.archive) {
    return badRequest('not_editable', `Items in status "${item.status}" cannot be edited.`);
  }

  if (body?.archive === true) {
    await db.updateTable('content_items').set({ status: 'archived' }).where('id', '=', contentId).execute();
    await audit(db, admin, 'content.archive', { type: 'content_item', id: contentId });
    return NextResponse.json({ ok: true, status: 'archived' });
  }

  const update: Record<string, unknown> = {};
  if (typeof body?.title === 'string') update.title = body.title.trim().slice(0, 200) || null;
  if (typeof body?.caption === 'string') update.caption = body.caption.slice(0, 2200) || null;
  if (typeof body?.image_text === 'string') update.image_text = body.image_text.trim().slice(0, 200) || null;
  if (['generated', 'manual', 'none'].includes(String(body?.image_text_mode))) update.image_text_mode = body.image_text_mode;
  if (['original', 'carousel', 'combined'].includes(String(body?.output_mode))) update.output_mode = body.output_mode;
  if (['price_drop', 'general'].includes(String(body?.purpose))) update.purpose = body.purpose;
  if (body?.content_type === 'story' || body?.content_type === 'post') update.content_type = body.content_type;
  if (typeof body?.comment_automation === 'boolean') update.comment_automation = body.comment_automation;
  if (Array.isArray(body?.platforms)) {
    const platforms = (body.platforms as unknown[]).map(String).filter((p) => p === 'facebook' || p === 'instagram');
    if (!platforms.length) return badRequest('missing_platforms');
    update.platforms = platforms;
  }
  if (body?.promotion_ends_at === null) update.promotion_ends_at = null;
  else if (typeof body?.promotion_ends_at === 'string') {
    const d = new Date(body.promotion_ends_at);
    if (Number.isNaN(d.getTime())) return badRequest('invalid_promotion_end');
    update.promotion_ends_at = d.toISOString();
  }

  // Selected products (+ per-product new price for price drops).
  if (Array.isArray(body?.products)) {
    const rows = (body.products as any[]).slice(0, 20).map((p, i) => ({
      product_id: String(p?.product_id ?? ''),
      new_price: p?.new_price != null ? Number(p.new_price) : null,
      show_price: p?.show_price === true,
      position: i,
    })).filter((p) => p.product_id);
    for (const r of rows) {
      if (r.new_price != null && !(r.new_price > 0)) return badRequest('invalid_new_price');
    }
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('content_products').where('content_item_id', '=', contentId).execute();
      for (const r of rows) {
        await trx.insertInto('content_products').values({
          content_item_id: contentId,
          product_id: r.product_id,
          new_price: r.new_price,
          show_price: r.show_price,
          position: r.position,
        }).execute();
      }
    });
  }

  if (Object.keys(update).length) {
    await db.updateTable('content_items').set(update as any).where('id', '=', contentId).execute();
  }
  await audit(db, admin, 'content.update', { type: 'content_item', id: contentId, detail: { fields: Object.keys(update) } });
  const fresh = await db.selectFrom('content_items').selectAll().where('id', '=', contentId).executeTakeFirst();
  return NextResponse.json({ item: fresh });
}
