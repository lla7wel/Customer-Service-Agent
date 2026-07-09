/**
 * Campaign publishing + pricing refresh. Shared by the Next.js campaign routes
 * and the campaign-scheduler cron so there is ONE publish implementation.
 *
 * Model:
 *  - campaign_assets  : images linked to a campaign (uploaded / product / AI).
 *  - facebook_posts   : post drafts. A campaign can be ONE carousel post (all
 *                       assets) or MULTIPLE posts (one image each). asset_ids
 *                       holds the campaign_assets ids in display order.
 *  - publishPost()    : pushes one facebook_posts row to Meta and records result.
 */
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';
import { publishPhoto, publishCarousel, isMetaConfigured } from '../meta';
import { metaStatus } from '../status';
import { sanitizeCustomerText } from '../util/customer-text';

export interface PublishResult {
  ok: boolean;
  fbPostId?: string | null;
  error?: string;
  code?: 'not_configured' | 'no_images' | 'publish_failed';
  missing?: string[];
}

/** Refresh cached product pricing from active campaigns (fn in schema.sql). */
export async function refreshPricing(db: Kysely<DB>): Promise<{ ok: boolean; error?: string }> {
  try {
    await sql`select fn_refresh_product_pricing()`.execute(db);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'refresh_failed' };
  }
}

/** Resolve the public URLs for a list of campaign_assets ids, in order. */
async function assetUrls(db: Kysely<DB>, assetIds: string[]): Promise<string[]> {
  if (!assetIds.length) return [];
  const data = await db.selectFrom('campaign_assets').select(['id', 'public_url']).where('id', 'in', assetIds).execute();
  const map = new Map(data.map((a) => [a.id, a.public_url]));
  return assetIds.map((id) => map.get(id)).filter(Boolean) as string[];
}

/**
 * Create post draft(s) for a campaign from its current assets.
 *  - mode 'single'   → one carousel/image post with all assets.
 *  - mode 'multiple' → one image post per asset.
 * Replaces any existing DRAFT posts so the admin can re-decide before publishing.
 */
export async function prepareCampaignPosts(
  db: Kysely<DB>,
  campaignId: string,
  mode: 'single' | 'multiple',
  scheduledFor?: string | null,
): Promise<{ ok: boolean; created: number; error?: string }> {
  const assets = await db
    .selectFrom('campaign_assets')
    .select(['id', 'public_url', 'position', 'approved'])
    .where('campaign_id', '=', campaignId)
    .where('public_url', 'is not', null)
    .orderBy('position', 'asc')
    .execute();
  const withUrl = assets.filter((a) => a.public_url);
  // Prefer admin-approved assets when any exist; otherwise use all (back-compat).
  const approved = withUrl.filter((a) => a.approved === true);
  const usable = approved.length > 0 ? approved : withUrl;
  if (usable.length === 0) return { ok: false, created: 0, error: 'no_images' };

  // Clear previous drafts (keep published/failed for history).
  await db.deleteFrom('facebook_posts').where('campaign_id', '=', campaignId).where('status', 'in', ['draft', 'scheduled']).execute();

  const status = scheduledFor ? ('scheduled' as const) : ('draft' as const);
  let created = 0;
  if (mode === 'single') {
    await db
      .insertInto('facebook_posts')
      .values({
        campaign_id: campaignId,
        type: usable.length > 1 ? 'carousel' : 'image',
        status,
        asset_ids: usable.map((a) => a.id),
        scheduled_for: scheduledFor ?? null,
      })
      .execute();
    created = 1;
  } else {
    const rows = usable.map((a) => ({
      campaign_id: campaignId,
      type: 'image' as const,
      status,
      asset_ids: [a.id],
      scheduled_for: scheduledFor ?? null,
    }));
    await db.insertInto('facebook_posts').values(rows).execute();
    created = rows.length;
  }
  return { ok: true, created };
}

/** Publish ONE facebook_posts row to Meta. */
export async function publishPost(db: Kysely<DB>, postId: string): Promise<PublishResult> {
  if (!isMetaConfigured()) return { ok: false, code: 'not_configured', missing: metaStatus().missing };

  const post = await db.selectFrom('facebook_posts').selectAll().where('id', '=', postId).executeTakeFirst();
  if (!post) return { ok: false, error: 'not_found' };

  const campaign = post.campaign_id
    ? await db.selectFrom('campaigns').select('generated_caption').where('id', '=', post.campaign_id).executeTakeFirst()
    : undefined;
  const urls = await assetUrls(db, post.asset_ids ?? []);
  if (urls.length === 0) return { ok: false, code: 'no_images', error: 'This post has no uploaded images yet.' };

  // Final outbound safety gate on the public caption (no leaked tool/system text).
  const caption = sanitizeCustomerText(campaign?.generated_caption || post.caption || '') || undefined;

  await db.updateTable('facebook_posts').set({ status: 'publishing', error: null }).where('id', '=', postId).execute();
  let fbResult: any = null;
  try {
    fbResult =
      urls.length > 1
        ? await publishCarousel({ imageUrls: urls, caption })
        : await publishPhoto({ imageUrl: urls[0], caption });
  } catch (e: any) {
    await db.updateTable('facebook_posts').set({ status: 'failed', error: e?.message ?? 'publish_failed' }).where('id', '=', postId).execute();
    await db.insertInto('integration_logs').values({ integration: 'meta', direction: 'outbound', ok: false, error: e?.message ?? null }).execute();
    return { ok: false, code: 'publish_failed', error: e?.message || 'publish_failed' };
  }

  const fbPostId = fbResult?.post_id || fbResult?.id || null;
  await db
    .updateTable('facebook_posts')
    .set({ status: 'published', fb_post_id: fbPostId, published_at: new Date().toISOString() })
    .where('id', '=', postId)
    .execute();
  await db
    .insertInto('activity_logs')
    .values({
      actor_type: 'human', action: 'fb_post', entity_type: 'facebook_post', entity_id: postId,
      summary: `Published ${urls.length > 1 ? 'carousel' : 'image'} (${urls.length})`,
    })
    .execute();
  return { ok: true, fbPostId };
}

/**
 * Legacy convenience: publish a campaign directly from its assets (one carousel/
 * image). Kept for the simple "Publish campaign" action; new flow uses posts.
 */
export async function publishCampaign(db: Kysely<DB>, campaignId: string): Promise<PublishResult> {
  if (!isMetaConfigured()) return { ok: false, code: 'not_configured', missing: metaStatus().missing };
  const prep = await prepareCampaignPosts(db, campaignId, 'single');
  if (!prep.ok) return { ok: false, code: 'no_images', error: prep.error };
  const post = await db
    .selectFrom('facebook_posts')
    .select('id')
    .where('campaign_id', '=', campaignId)
    .where('status', '=', 'draft')
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!post) return { ok: false, error: 'no_post' };
  const r = await publishPost(db, post.id);
  if (r.ok) await db.updateTable('campaigns').set({ status: 'published' }).where('id', '=', campaignId).execute();
  return r;
}

/**
 * Scheduler tick: refresh pricing, then publish any due scheduled posts
 * (scheduled_for <= now). Marks the parent campaign published when a post goes out.
 */
export async function runSchedulerTick(db: Kysely<DB>) {
  const pricing = await refreshPricing(db);
  const nowIso = new Date().toISOString();
  const due = await db
    .selectFrom('facebook_posts')
    .select(['id', 'campaign_id'])
    .where('status', '=', 'scheduled')
    .where('scheduled_for', '<=', nowIso)
    .execute();

  const published: { id: string; ok: boolean; error?: string }[] = [];
  for (const p of due) {
    const r = await publishPost(db, p.id);
    if (r.ok && p.campaign_id) {
      await db.updateTable('campaigns').set({ status: 'published' }).where('id', '=', p.campaign_id).execute();
    }
    published.push({ id: p.id, ok: r.ok, error: r.error });
  }
  return { pricing, publishedCount: published.filter((p) => p.ok).length, attempted: published.length, published };
}
