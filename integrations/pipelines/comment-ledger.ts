/**
 * The shared comment reply ledger — the ONE place a comment is claimed before a
 * reply is sent, so an automatic and a manual reply can never both answer the
 * same comment.
 *
 *   - A claim is atomic (a single conditional UPDATE).
 *   - Manual takes precedence over an UNSENT automatic action (it may override an
 *     'auto' claim, never a 'sent' one).
 *   - Automatic never overrides a manual claim.
 *   - Automatic replies remain limited to app-published content (publication_id);
 *     they never run on imported/external posts (social_post_id only).
 */
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';
import { replyToComment } from '../providers/publishing';

export interface ClaimedComment {
  id: string;
  provider_comment_id: string;
  publication_id: string | null;
  social_post_id: string | null;
}

/**
 * Atomically claim a comment for a reply. Returns the row when the caller won
 * the claim, or null when it is already sent / claimed by a higher-precedence
 * actor. `manual` may take over an unsent `auto` claim; `auto` may not take over
 * anything already claimed.
 */
export async function claimComment(
  db: Kysely<DB>,
  commentId: string,
  source: 'auto' | 'manual',
  adminId: string | null,
): Promise<ClaimedComment | null> {
  const row = await db.updateTable('content_comments')
    .set({
      reply_claimed_at: new Date().toISOString(),
      reply_source: source,
      reply_by_admin_id: adminId,
    } as any)
    .where('id', '=', commentId)
    .where(sql<boolean>`reply_status is distinct from 'sent'`)
    .where((eb) => source === 'manual'
      // manual: unclaimed, or overriding an unsent auto claim
      ? eb.or([eb('reply_claimed_at', 'is', null), sql<boolean>`reply_source = 'auto'`])
      // auto: only if entirely unclaimed
      : eb('reply_claimed_at', 'is', null))
    .returning(['id', 'provider_comment_id', 'publication_id', 'social_post_id'])
    .executeTakeFirst();
  return row ?? null;
}

/** Release a claim so a failed send can be retried by either actor. */
export async function releaseClaim(db: Kysely<DB>, commentId: string): Promise<void> {
  await db.updateTable('content_comments').set({ reply_claimed_at: null } as any).where('id', '=', commentId).execute();
}

export interface ManualReplyResult {
  ok: boolean;
  status: 'sent' | 'failed' | 'conflict';
  providerId?: string | null;
  error?: string;
}

/**
 * Send a manual reply to a comment on ANY synced post (app or external), with
 * the atomic claim + idempotency. A conflict (already answered) is reported, not
 * duplicated.
 */
export async function manualReplyToComment(
  db: Kysely<DB>,
  commentId: string,
  adminId: string | null,
  text: string,
): Promise<ManualReplyResult> {
  const existing = await db.selectFrom('content_comments')
    .select(['provider_comment_id', 'reply_status'])
    .where('id', '=', commentId).executeTakeFirst();
  if (!existing) return { ok: false, status: 'conflict', error: 'not_found' };
  if (existing.reply_status === 'sent') return { ok: false, status: 'conflict', error: 'already_answered' };

  const claim = await claimComment(db, commentId, 'manual', adminId);
  if (!claim) return { ok: false, status: 'conflict', error: 'already_answered' };

  try {
    const res = await replyToComment(claim.provider_comment_id, text);
    await db.updateTable('content_comments').set({
      reply_text: text, reply_status: 'sent', reply_provider_id: res.id ?? null,
      decision: 'reply_dm' as any, decision_reason: 'manual reply', reply_error: null,
    } as any).where('id', '=', commentId).execute();
    return { ok: true, status: 'sent', providerId: res.id };
  } catch (e: any) {
    // Failure → record the error and RELEASE the claim so it can be retried.
    await db.updateTable('content_comments').set({
      reply_text: text, reply_status: 'failed', reply_error: e?.message ?? 'send_failed', reply_claimed_at: null,
    } as any).where('id', '=', commentId).execute();
    return { ok: false, status: 'failed', error: e?.message ?? 'send_failed' };
  }
}
