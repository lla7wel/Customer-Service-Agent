import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, notFound } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Paginated comment thread for a synced post. */
export async function GET(req: NextRequest, props: { params: Promise<{ postId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db } = auth.ctx;
  const { postId } = await props.params;

  const post = await db.selectFrom('social_posts').select(['id', 'source']).where('id', '=', postId).executeTakeFirst();
  if (!post) return notFound();

  const limit = Math.min(50, Math.max(5, Number(req.nextUrl.searchParams.get('limit') ?? 20)));
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get('offset') ?? 0));

  const comments = await db.selectFrom('content_comments')
    .select(['id', 'provider_comment_id', 'parent_comment_id', 'author_name', 'body', 'commented_at',
      'reply_status', 'reply_text', 'reply_error', 'reply_source', 'decision'])
    .where('social_post_id', '=', postId)
    .orderBy('commented_at', (ob) => ob.desc().nullsLast())
    .limit(limit + 1).offset(offset)
    .execute();

  const hasMore = comments.length > limit;
  return NextResponse.json({
    post: { id: post.id, source: post.source },
    comments: comments.slice(0, limit),
    hasMore,
    // Automatic replies only ever run on app-published content.
    auto_reply_eligible: post.source === 'app',
  });
}
