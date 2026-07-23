import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/api';
import { primeMetaFromDb } from '@integrations/providers/connection';
import { runSocialSync } from '@integrations/pipelines/social-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Paginated Published Feed (app + external Meta posts). Content-Studio roles. */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db } = auth.ctx;

  const limit = Math.min(30, Math.max(5, Number(req.nextUrl.searchParams.get('limit') ?? 12)));
  const before = req.nextUrl.searchParams.get('before'); // ISO cursor (provider_created_at)
  const platform = req.nextUrl.searchParams.get('platform');

  let q = db.selectFrom('social_posts')
    .select(['id', 'platform', 'provider_post_id', 'source', 'post_type', 'caption', 'media_type', 'media_url', 'media', 'permalink', 'provider_created_at', 'engagement', 'comment_count', 'provider_deleted'])
    .orderBy('provider_created_at', (ob) => ob.desc().nullsLast())
    .limit(limit + 1);
  if (before) q = q.where('provider_created_at', '<', before as any);
  if (platform === 'facebook' || platform === 'instagram') q = q.where('platform', '=', platform);
  const rows = await q.execute();

  const hasMore = rows.length > limit;
  const posts = rows.slice(0, limit);
  const nextCursor = hasMore ? posts[posts.length - 1]?.provider_created_at : null;
  return NextResponse.json({ posts, nextCursor, hasMore });
}

/** Trigger a bounded incremental sync tick (durable backfill runs in the worker). */
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db } = auth.ctx;
  await primeMetaFromDb(db).catch(() => {});
  const result = await runSocialSync(db);
  return NextResponse.json({ ok: true, synced: result });
}
