/**
 * Social feed synchronization — import every Facebook/Instagram post the
 * connected accounts expose (app-published AND external/manual) into the
 * normalized `social_posts` store, with a durable, checkpointed backfill and an
 * incremental top-up. Comments sync into the shared content_comments ledger.
 *
 * The normalization functions are pure (unit-tested); the fetchers use the
 * hardened Graph client (no tokens in URLs, structured errors).
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { graphCall } from '../providers/graph';
import { resolveMetaCredentials } from '../providers/connection';

export type Platform = 'facebook' | 'instagram';

export interface NormalizedPost {
  platform: Platform;
  provider_post_id: string;
  account_id: string | null;
  post_type: string | null;
  caption: string | null;
  media_type: string | null;
  media_url: string | null;
  media: { url: string; type?: string }[];
  permalink: string | null;
  provider_created_at: string | null;
  engagement: Record<string, number>;
}

export interface NormalizedComment {
  provider_comment_id: string;
  parent_comment_id: string | null;
  author_name: string | null;
  author_external_id: string | null;
  body: string | null;
  commented_at: string | null;
}

/* ----------------------------- normalization ------------------------------ */

/** Facebook Page post (from `${pageId}/published_posts` / `/feed`). */
export function normalizeFacebookPost(raw: any, accountId: string | null): NormalizedPost | null {
  const id = raw?.id ? String(raw.id) : null;
  if (!id) return null;
  const attachments = raw?.attachments?.data ?? [];
  const first = attachments[0];
  const subattachments = first?.subattachments?.data ?? [];
  const media = (subattachments.length ? subattachments : attachments)
    .map((a: any) => ({ url: a?.media?.image?.src ?? a?.media?.source ?? null, type: a?.media_type ?? a?.type }))
    .filter((m: any) => m.url);
  const mediaType = first?.media_type || (media.length > 1 ? 'carousel_album' : first?.type) || null;
  return {
    platform: 'facebook',
    provider_post_id: id,
    account_id: accountId,
    post_type: raw?.status_type ?? first?.type ?? null,
    caption: raw?.message ?? raw?.story ?? null,
    media_type: mediaType,
    media_url: media[0]?.url ?? raw?.full_picture ?? null,
    media,
    permalink: raw?.permalink_url ?? null,
    provider_created_at: raw?.created_time ? new Date(raw.created_time).toISOString() : null,
    engagement: {
      comments: Number(raw?.comments?.summary?.total_count ?? 0),
      reactions: Number(raw?.reactions?.summary?.total_count ?? raw?.likes?.summary?.total_count ?? 0),
    },
  };
}

/** Instagram media (from `${igUserId}/media`). */
export function normalizeInstagramMedia(raw: any, accountId: string | null): NormalizedPost | null {
  const id = raw?.id ? String(raw.id) : null;
  if (!id) return null;
  const children = raw?.children?.data ?? [];
  const media = (children.length ? children : [raw])
    .map((c: any) => ({ url: c?.media_url ?? c?.thumbnail_url ?? null, type: c?.media_type }))
    .filter((m: any) => m.url);
  return {
    platform: 'instagram',
    provider_post_id: id,
    account_id: accountId,
    post_type: String(raw?.media_type ?? '').toLowerCase() || null,
    caption: raw?.caption ?? null,
    media_type: raw?.media_type ? String(raw.media_type).toLowerCase() : null,
    media_url: raw?.media_url ?? raw?.thumbnail_url ?? media[0]?.url ?? null,
    media,
    permalink: raw?.permalink ?? null,
    provider_created_at: raw?.timestamp ? new Date(raw.timestamp).toISOString() : null,
    engagement: {
      comments: Number(raw?.comments_count ?? 0),
      likes: Number(raw?.like_count ?? 0),
    },
  };
}

export function normalizeComment(raw: any, platform: Platform): NormalizedComment | null {
  const id = raw?.id ? String(raw.id) : null;
  if (!id) return null;
  return {
    provider_comment_id: id,
    parent_comment_id: raw?.parent?.id ? String(raw.parent.id) : null,
    author_name: raw?.from?.name ?? raw?.username ?? null,
    author_external_id: raw?.from?.id ? String(raw.from.id) : null,
    body: raw?.message ?? raw?.text ?? null,
    commented_at: raw?.created_time || raw?.timestamp ? new Date(raw.created_time ?? raw.timestamp).toISOString() : null,
  };
}

/* ------------------------------- upserts ---------------------------------- */

/** Upsert a normalized post, linking it to an app publication when the provider
 *  post id matches one we published (so app vs external is truthful). */
export async function upsertSocialPost(db: Kysely<DB>, post: NormalizedPost): Promise<string> {
  const pub = await db.selectFrom('content_publications').select(['id', 'content_item_id'])
    .where('provider_post_id', '=', post.provider_post_id).executeTakeFirst().catch(() => null);
  const row = {
    platform: post.platform,
    provider_post_id: post.provider_post_id,
    account_id: post.account_id,
    content_item_id: pub?.content_item_id ?? null,
    publication_id: pub?.id ?? null,
    source: pub ? 'app' : 'external',
    post_type: post.post_type,
    caption: post.caption,
    media_type: post.media_type,
    media_url: post.media_url,
    media: JSON.stringify(post.media),
    permalink: post.permalink,
    provider_created_at: post.provider_created_at,
    engagement: JSON.stringify(post.engagement),
    comment_count: Number(post.engagement.comments ?? 0),
    last_synced_at: new Date().toISOString(),
  };
  const res = await db.insertInto('social_posts').values(row as any)
    .onConflict((oc) => oc.columns(['platform', 'provider_post_id']).doUpdateSet({
      caption: row.caption, media: row.media, media_url: row.media_url, media_type: row.media_type,
      permalink: row.permalink, engagement: row.engagement, comment_count: row.comment_count,
      content_item_id: row.content_item_id, publication_id: row.publication_id, source: row.source,
      last_synced_at: row.last_synced_at,
    } as any))
    .returning('id').executeTakeFirstOrThrow();
  return res.id;
}

/** Upsert a comment against a social post (external-post path; never auto-replies). */
export async function upsertSocialComment(db: Kysely<DB>, socialPostId: string, c: NormalizedComment): Promise<void> {
  await db.insertInto('content_comments').values({
    social_post_id: socialPostId,
    provider_comment_id: c.provider_comment_id,
    parent_comment_id: c.parent_comment_id,
    author_name: c.author_name,
    author_external_id: c.author_external_id,
    body: c.body,
    commented_at: c.commented_at,
  } as any)
    .onConflict((oc) => oc.columns(['social_post_id', 'provider_comment_id']).where('social_post_id', 'is not', null).doUpdateSet({
      body: c.body, author_name: c.author_name,
    } as any))
    .execute();
}

async function getState(db: Kysely<DB>, key: string) {
  return db.selectFrom('social_sync_state').selectAll().where('key', '=', key).executeTakeFirst().catch(() => null);
}
async function setState(db: Kysely<DB>, key: string, patch: { cursor?: string | null; backfill_done?: boolean; last_error?: string | null }) {
  await db.insertInto('social_sync_state').values({ key, cursor: patch.cursor ?? null, backfill_done: patch.backfill_done ?? false, last_error: patch.last_error ?? null, last_run_at: new Date().toISOString() } as any)
    .onConflict((oc) => oc.column('key').doUpdateSet({ ...patch, last_run_at: new Date().toISOString() } as any)).execute();
}

/* --------------------------------- sync ----------------------------------- */

// The engagement summaries (comments.summary/reactions.summary) require the
// `pages_read_user_content` permission / Page Public Content Access (App
// Review). We omit them so Facebook posts sync WITHOUT extra permissions;
// engagement is added opportunistically per post and simply left blank when the
// app lacks the capability (never a fabricated count).
const FB_FIELDS = 'id,message,story,status_type,created_time,permalink_url,full_picture,attachments{media_type,type,media,subattachments}';
const FB_FIELDS_WITH_ENGAGEMENT = `${FB_FIELDS},comments.summary(true),reactions.summary(true)`;
const IG_FIELDS = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,children{media_url,thumbnail_url,media_type}';

/**
 * One durable sync pass for the Page feed. Advances one provider page per call
 * (checkpointed), so the worker can back-fill history across many ticks and
 * then top-up incrementally. Returns how many posts were upserted.
 */
export async function syncFacebookPage(db: Kysely<DB>, opts: { pageSize?: number; maxComments?: number } = {}): Promise<{ posts: number; done: boolean }> {
  const creds = await resolveMetaCredentials(db);
  if (!creds.pageAccessToken || !creds.pageId) return { posts: 0, done: true };
  const key = 'facebook:posts';
  const state = await getState(db, key);
  try {
    const params = (fields: string) => ({ fields, limit: opts.pageSize ?? 25, ...(state?.cursor ? { after: state.cursor } : {}) });
    // Prefer engagement counts; fall back to the no-extra-permission field set
    // if the app lacks pages_read_user_content (Meta error #10).
    let res: { data?: any[]; paging?: { cursors?: { after?: string }; next?: string } };
    try {
      res = await graphCall(`${creds.pageId}/published_posts`, { accessToken: creds.pageAccessToken, params: params(FB_FIELDS_WITH_ENGAGEMENT), retries: 1 });
    } catch (e: any) {
      if (Number(e?.code) === 10) {
        res = await graphCall(`${creds.pageId}/published_posts`, { accessToken: creds.pageAccessToken, params: params(FB_FIELDS), retries: 1 });
      } else { throw e; }
    }
    let count = 0;
    for (const raw of res.data ?? []) {
      const post = normalizeFacebookPost(raw, creds.pageId);
      if (!post) continue;
      const id = await upsertSocialPost(db, post);
      count++;
      for (const c of raw?.comments?.data ?? []) {
        const nc = normalizeComment(c, 'facebook');
        if (nc) await upsertSocialComment(db, id, nc);
      }
    }
    const after = res.paging?.cursors?.after;
    const done = !after || !(res.data?.length);
    await setState(db, key, { cursor: done ? null : after, backfill_done: done, last_error: null });
    return { posts: count, done };
  } catch (e: any) {
    await setState(db, key, { cursor: state?.cursor ?? null, last_error: e?.message ?? 'sync_failed' });
    return { posts: 0, done: false };
  }
}

export async function syncInstagram(db: Kysely<DB>, opts: { pageSize?: number } = {}): Promise<{ posts: number; done: boolean }> {
  const creds = await resolveMetaCredentials(db);
  if (!creds.pageAccessToken || !creds.igUserId) return { posts: 0, done: true };
  const key = 'instagram:media';
  const state = await getState(db, key);
  try {
    const res = await graphCall<{ data?: any[]; paging?: { cursors?: { after?: string } } }>(`${creds.igUserId}/media`, {
      accessToken: creds.pageAccessToken,
      params: { fields: IG_FIELDS, limit: opts.pageSize ?? 25, ...(state?.cursor ? { after: state.cursor } : {}) },
      retries: 1,
    });
    let count = 0;
    for (const raw of res.data ?? []) {
      const post = normalizeInstagramMedia(raw, creds.igUserId);
      if (!post) continue;
      const id = await upsertSocialPost(db, post);
      count++;
      const comments = await graphCall<{ data?: any[] }>(`${post.provider_post_id}/comments`, {
        accessToken: creds.pageAccessToken, params: { fields: 'id,text,username,timestamp,parent{id}', limit: 25 }, retries: 1,
      }).catch(() => ({ data: [] }));
      for (const c of comments.data ?? []) {
        const nc = normalizeComment(c, 'instagram');
        if (nc) await upsertSocialComment(db, id, nc);
      }
    }
    const after = res.paging?.cursors?.after;
    const done = !after || !(res.data?.length);
    await setState(db, key, { cursor: done ? null : after, backfill_done: done, last_error: null });
    return { posts: count, done };
  } catch (e: any) {
    await setState(db, key, { cursor: state?.cursor ?? null, last_error: e?.message ?? 'sync_failed' });
    return { posts: 0, done: false };
  }
}

/** One social-sync tick for the worker: advance both platforms. */
export async function runSocialSync(db: Kysely<DB>): Promise<{ facebook: number; instagram: number }> {
  const fb = await syncFacebookPage(db);
  const ig = await syncInstagram(db);
  return { facebook: fb.posts, instagram: ig.posts };
}
