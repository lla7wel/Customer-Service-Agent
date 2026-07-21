/**
 * Comment automation — ONLY for content this app published.
 *
 * Eligibility is structural: comments are fetched exclusively from
 * content_publications rows with a provider_post_id, so an old/manual post can
 * never be answered by construction. Per comment:
 *
 *   * dedupe: (publication_id, provider_comment_id) unique — one decision,
 *     one reply, forever (no loops, no duplicate replies);
 *   * own comments and replies TO our replies are recorded and skipped;
 *   * comments older than the publication or seen after >7 days are skipped
 *     as old rather than answered late;
 *   * exactly ONE linked product with an active verified price and no
 *     sensitive topic → public reply with the exact price + DM invitation;
 *   * anything else (multiple products, missing price, orders, complaints,
 *     payment/delivery issues) → concise DM invitation, never a guess; the
 *     sensitive cases are marked for human attention in Content Studio;
 *   * replies are deterministic Libyan-Arabic templates — a public surface is
 *     no place for model improvisation;
 *   * per-item automation can be disabled (content_items.comment_automation).
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { fbGetComments, igGetComments, replyToComment, type ProviderComment } from '../providers/publishing';
import { classifyIntent } from './intent';

const MAX_COMMENT_AGE_DAYS = 7;
const POLL_WINDOW_DAYS = 14;

export function buildPriceReply(price: number): string {
  const formatted = Number.isInteger(price) ? String(price) : price.toFixed(2);
  return `أهلاً بيك 🤍 سعره ${formatted} دينار. وللطلب أو أي استفسار ابعتلنا رسالة خاصة وإحنا في الخدمة.`;
}

export function buildDmReply(): string {
  return 'أهلاً بيك 🤍 ابعتلنا رسالة خاصة ونجاوبوك على كل التفاصيل.';
}

export interface CommentDecision {
  decision: 'reply_price' | 'reply_dm' | 'skip_own' | 'skip_old' | 'skip_disabled' | 'human_attention';
  replyText: string | null;
  reason: string;
}

export function decideCommentReply(args: {
  comment: ProviderComment;
  publicationPublishedAt: string | null;
  automationEnabled: boolean;
  linkedProducts: { name: string; price: number | null }[];
}): CommentDecision {
  const { comment } = args;
  if (comment.fromSelf) return { decision: 'skip_own', replyText: null, reason: 'own comment' };
  if (!args.automationEnabled) return { decision: 'skip_disabled', replyText: null, reason: 'automation disabled for this item' };

  const commentedAt = comment.createdTime ? new Date(comment.createdTime).getTime() : null;
  if (commentedAt) {
    if (args.publicationPublishedAt && commentedAt < new Date(args.publicationPublishedAt).getTime() - 60_000) {
      return { decision: 'skip_old', replyText: null, reason: 'comment predates the publication' };
    }
    if (Date.now() - commentedAt > MAX_COMMENT_AGE_DAYS * 24 * 3600 * 1000) {
      return { decision: 'skip_old', replyText: null, reason: 'comment is too old to answer' };
    }
  }

  const intent = classifyIntent(comment.text ?? '');
  const sensitive = intent.needsHumanAttention;
  const single = args.linkedProducts.length === 1 ? args.linkedProducts[0] : null;

  if (single && single.price != null && single.price > 0 && !sensitive) {
    return { decision: 'reply_price', replyText: buildPriceReply(single.price), reason: 'single product with verified active price' };
  }
  if (sensitive) {
    return { decision: 'human_attention', replyText: buildDmReply(), reason: `sensitive topic: ${intent.intent}` };
  }
  return {
    decision: 'reply_dm',
    replyText: buildDmReply(),
    reason: args.linkedProducts.length > 1 ? 'multiple products — identity unclear' : 'no verified price — never guess',
  };
}

/** Poll comments for recent app-published content and process new ones. */
export async function pollAndProcessComments(db: Kysely<DB>): Promise<{ seen: number; replied: number; failed: number }> {
  const since = new Date(Date.now() - POLL_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const publications = await db
    .selectFrom('content_publications as cp')
    .innerJoin('content_items as ci', 'ci.id', 'cp.content_item_id')
    .select([
      'cp.id as publication_id', 'cp.platform', 'cp.provider_post_id', 'cp.published_at',
      'ci.id as item_id', 'ci.comment_automation',
    ])
    .where('cp.status', '=', 'published')
    .where('cp.provider_post_id', 'is not', null)
    .where('cp.published_at', '>', since)
    .execute();

  let seen = 0, replied = 0, failed = 0;
  for (const pub of publications) {
    let comments: ProviderComment[] = [];
    try {
      comments = pub.platform === 'instagram'
        ? await igGetComments(pub.provider_post_id!)
        : await fbGetComments(pub.provider_post_id!);
    } catch {
      continue; // provider hiccup — next poll retries; nothing is lost
    }

    const linkedProducts = await db
      .selectFrom('content_products as cp2')
      .innerJoin('products as p', 'p.id', 'cp2.product_id')
      .select(['p.libyan_display_name', 'p.arabic_name', 'p.english_name', 'p.active_price', 'p.status'])
      .where('cp2.content_item_id', '=', pub.item_id)
      .execute()
      .then((rows) => rows
        .filter((r) => r.status === 'active')
        .map((r) => ({ name: r.libyan_display_name ?? r.arabic_name ?? r.english_name ?? '', price: r.active_price != null ? Number(r.active_price) : null })));

    for (const comment of comments) {
      // Replies to comments (threads) are skipped: we answer top-level only.
      if (comment.parentId) continue;
      const inserted = await db
        .insertInto('content_comments')
        .values({
          publication_id: pub.publication_id,
          provider_comment_id: comment.id,
          parent_comment_id: comment.parentId,
          author_name: comment.authorName,
          author_external_id: comment.authorId,
          body: comment.text,
          commented_at: comment.createdTime,
        })
        .onConflict((oc) => oc.columns(['publication_id', 'provider_comment_id']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!inserted) continue; // already decided — never loop
      seen++;

      const decision = decideCommentReply({
        comment,
        publicationPublishedAt: pub.published_at,
        automationEnabled: pub.comment_automation !== false,
        linkedProducts,
      });

      if (!decision.replyText) {
        await db.updateTable('content_comments')
          .set({ decision: decision.decision, decision_reason: decision.reason, reply_status: 'skipped' })
          .where('id', '=', inserted.id).execute();
        continue;
      }
      try {
        const res = await replyToComment(comment.id, decision.replyText);
        await db.updateTable('content_comments')
          .set({
            decision: decision.decision, decision_reason: decision.reason,
            reply_text: decision.replyText, reply_status: 'sent', reply_provider_id: res.id,
          })
          .where('id', '=', inserted.id).execute();
        replied++;
      } catch (e: any) {
        await db.updateTable('content_comments')
          .set({
            decision: decision.decision, decision_reason: decision.reason,
            reply_text: decision.replyText, reply_status: 'failed',
            reply_error: String(e?.message ?? 'reply failed').slice(0, 500),
          })
          .where('id', '=', inserted.id).execute();
        failed++;
      }
    }
  }
  return { seen, replied, failed };
}
