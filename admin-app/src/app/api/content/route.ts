import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest } from '@/lib/api';
import { audit } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** List content items with product/publication summaries (?status= filter). */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db } = auth.ctx;
  const status = req.nextUrl.searchParams.get('status');

  let q = db
    .selectFrom('content_items as ci')
    .leftJoin('content_products as cp', 'cp.content_item_id', 'ci.id')
    .leftJoin('content_publications as pub', 'pub.content_item_id', 'ci.id')
    .select((eb) => [
      'ci.id', 'ci.title', 'ci.content_type', 'ci.platforms', 'ci.purpose', 'ci.output_mode',
      'ci.status', 'ci.scheduled_for', 'ci.created_at', 'ci.updated_at', 'ci.last_error',
      eb.fn.count<number>('cp.id').distinct().as('product_count'),
      eb.fn.count<number>('pub.id').distinct().as('publication_count'),
    ])
    .groupBy(['ci.id'])
    .orderBy('ci.updated_at', 'desc')
    .limit(100);
  if (status && status !== 'all') q = q.where('ci.status', '=', status);
  else if (!status) q = q.where('ci.status', '!=', 'archived');
  const items = await q.execute();
  return NextResponse.json({ items });
}

/** Create a draft content item. */
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  const body = await req.json().catch(() => ({}));

  const contentType = body?.content_type === 'story' ? 'story' : 'post';
  const platforms = Array.isArray(body?.platforms)
    ? (body.platforms as unknown[]).map(String).filter((p) => p === 'facebook' || p === 'instagram')
    : [];
  const purpose = body?.purpose === 'price_drop' ? 'price_drop' : 'general';
  const outputMode = ['original', 'carousel', 'combined'].includes(String(body?.output_mode)) ? String(body.output_mode) : 'original';
  const imageTextMode = ['generated', 'manual', 'none'].includes(String(body?.image_text_mode)) ? String(body.image_text_mode) : 'none';
  if (!platforms.length) return badRequest('missing_platforms', 'Choose Facebook, Instagram, or both.');

  const item = await db
    .insertInto('content_items')
    .values({
      title: typeof body?.title === 'string' ? body.title.trim().slice(0, 200) || null : null,
      content_type: contentType,
      platforms,
      purpose,
      output_mode: outputMode,
      image_text_mode: imageTextMode,
      status: 'draft',
      created_by: admin.id === '00000000-0000-0000-0000-000000000000' ? null : admin.id,
    })
    .returningAll()
    .executeTakeFirst();
  await audit(db, admin, 'content.create', { type: 'content_item', id: item?.id });
  return NextResponse.json({ item }, { status: 201 });
}
