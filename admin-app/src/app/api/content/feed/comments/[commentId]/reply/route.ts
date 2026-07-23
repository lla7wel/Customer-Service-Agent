import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest } from '@/lib/api';
import { audit } from '@/lib/auth';
import { primeMetaFromDb } from '@integrations/providers/connection';
import { manualReplyToComment } from '@integrations/pipelines/comment-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Manual reply to a comment on any synced post. Any Content-Studio role may
 * reply; the shared ledger claims the comment atomically so an automatic reply
 * can never also answer it. A conflict (already answered) is reported (409).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ commentId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  const { commentId } = await props.params;

  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return badRequest('missing_text', 'Reply text is required.');
  if (text.length > 8000) return badRequest('too_long');

  await primeMetaFromDb(db).catch(() => {});
  const adminId = admin.id === '00000000-0000-0000-0000-000000000000' ? null : admin.id;
  const result = await manualReplyToComment(db, commentId, adminId, text);

  await audit(db, admin, 'content.comment.manual_reply', { type: 'content_comment', id: commentId, detail: { status: result.status } });

  if (result.status === 'conflict') return NextResponse.json({ ...result }, { status: 409 });
  if (result.status === 'failed') return NextResponse.json({ ...result }, { status: 502 });
  return NextResponse.json({ ...result });
}
