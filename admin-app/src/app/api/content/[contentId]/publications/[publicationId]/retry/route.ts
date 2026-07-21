import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, notFound } from '@/lib/api';
import { audit } from '@/lib/auth';
import { retryPublication } from '@integrations/pipelines/content-publish';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Retry ONLY the failed platform of a partially-published item. */
export async function POST(req: NextRequest, props: { params: Promise<{ contentId: string; publicationId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  const { contentId, publicationId } = await props.params;

  const pub = await db.selectFrom('content_publications')
    .select(['id', 'content_item_id', 'status'])
    .where('id', '=', publicationId)
    .where('content_item_id', '=', contentId)
    .executeTakeFirst();
  if (!pub) return notFound();

  const ok = await retryPublication(db, publicationId);
  if (ok) await audit(db, admin, 'content.publication_retry', { type: 'content_publication', id: publicationId });
  return NextResponse.json({ ok });
}
