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
import type { SupabaseClient } from '@supabase/supabase-js';
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
export async function refreshPricing(db: SupabaseClient): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db.rpc('fn_refresh_product_pricing');
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Resolve the public URLs for a list of campaign_assets ids, in order. */
async function assetUrls(db: SupabaseClient, assetIds: string[]): Promise<string[]> {
  if (!assetIds.length) return [];
  const { data } = await db.from('campaign_assets').select('id, public_url').in('id', assetIds);
  const map = new Map((data ?? []).map((a: any) => [a.id, a.public_url]));
  return assetIds.map((id) => map.get(id)).filter(Boolean) as string[];
}

/**
 * Create post draft(s) for a campaign from its current assets.
 *  - mode 'single'   → one carousel/image post with all assets.
 *  - mode 'multiple' → one image post per asset.
 * Replaces any existing DRAFT posts so the admin can re-decide before publishing.
 */
export async function prepareCampaignPosts(
  db: SupabaseClient,
  campaignId: string,
  mode: 'single' | 'multiple',
  scheduledFor?: string | null,
): Promise<{ ok: boolean; created: number; error?: string }> {
  const { data: assets } = await db
    .from('campaign_assets')
    .select('id, public_url, position')
    .eq('campaign_id', campaignId)
    .not('public_url', 'is', null)
    .order('position', { ascending: true });
  const withUrl = (assets ?? []).filter((a: any) => a.public_url);
  // Prefer admin-approved assets when any exist; otherwise use all (back-compat).
  // Queried separately + defensively so this works even before migration 0008
  // (the `approved` column) is applied.
  let approvedIds = new Set<string>();
  try {
    const { data: ap } = await db.from('campaign_assets').select('id').eq('campaign_id', campaignId).eq('approved', true);
    approvedIds = new Set((ap ?? []).map((a: any) => a.id));
  } catch { /* column not present yet — fall back to all */ }
  const approved = withUrl.filter((a: any) => approvedIds.has(a.id));
  const usable = approved.length > 0 ? approved : withUrl;
  if (usable.length === 0) return { ok: false, created: 0, error: 'no_images' };

  // Clear previous drafts (keep published/failed for history).
  await db.from('facebook_posts').delete().eq('campaign_id', campaignId).in('status', ['draft', 'scheduled']);

  const status = scheduledFor ? 'scheduled' : 'draft';
  let created = 0;
  if (mode === 'single') {
    await db.from('facebook_posts').insert({
      campaign_id: campaignId,
      type: usable.length > 1 ? 'carousel' : 'image',
      status,
      asset_ids: usable.map((a: any) => a.id),
      scheduled_for: scheduledFor ?? null,
    });
    created = 1;
  } else {
    const rows = usable.map((a: any) => ({
      campaign_id: campaignId,
      type: 'image',
      status,
      asset_ids: [a.id],
      scheduled_for: scheduledFor ?? null,
    }));
    await db.from('facebook_posts').insert(rows);
    created = rows.length;
  }
  return { ok: true, created };
}

/** Publish ONE facebook_posts row to Meta. */
export async function publishPost(db: SupabaseClient, postId: string): Promise<PublishResult> {
  if (!isMetaConfigured()) return { ok: false, code: 'not_configured', missing: metaStatus().missing };

  const { data: post } = await db.from('facebook_posts').select('*').eq('id', postId).maybeSingle();
  if (!post) return { ok: false, error: 'not_found' };

  const { data: campaign } = await db.from('campaigns').select('generated_caption').eq('id', post.campaign_id).maybeSingle();
  const urls = await assetUrls(db, post.asset_ids ?? []);
  if (urls.length === 0) return { ok: false, code: 'no_images', error: 'This post has no uploaded images yet.' };

  // Final outbound safety gate on the public caption (no leaked tool/system text).
  const caption = sanitizeCustomerText(campaign?.generated_caption || post.caption || '') || undefined;

  await db.from('facebook_posts').update({ status: 'publishing', error: null }).eq('id', postId);
  let fbResult: any = null;
  try {
    fbResult =
      urls.length > 1
        ? await publishCarousel({ imageUrls: urls, caption })
        : await publishPhoto({ imageUrl: urls[0], caption });
  } catch (e: any) {
    await db.from('facebook_posts').update({ status: 'failed', error: e?.message ?? 'publish_failed' }).eq('id', postId);
    await db.from('integration_logs').insert({ integration: 'meta', direction: 'outbound', ok: false, error: e?.message });
    return { ok: false, code: 'publish_failed', error: e?.message || 'publish_failed' };
  }

  const fbPostId = fbResult?.post_id || fbResult?.id || null;
  await db.from('facebook_posts').update({ status: 'published', fb_post_id: fbPostId, published_at: new Date().toISOString() }).eq('id', postId);
  await db.from('activity_logs').insert({
    actor_type: 'human', action: 'fb_post', entity_type: 'facebook_post', entity_id: postId,
    summary: `Published ${urls.length > 1 ? 'carousel' : 'image'} (${urls.length})`,
  });
  return { ok: true, fbPostId };
}

/**
 * Legacy convenience: publish a campaign directly from its assets (one carousel/
 * image). Kept for the simple "Publish campaign" action; new flow uses posts.
 */
export async function publishCampaign(db: SupabaseClient, campaignId: string): Promise<PublishResult> {
  if (!isMetaConfigured()) return { ok: false, code: 'not_configured', missing: metaStatus().missing };
  const prep = await prepareCampaignPosts(db, campaignId, 'single');
  if (!prep.ok) return { ok: false, code: 'no_images', error: prep.error };
  const { data: post } = await db
    .from('facebook_posts')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!post) return { ok: false, error: 'no_post' };
  const r = await publishPost(db, post.id);
  if (r.ok) await db.from('campaigns').update({ status: 'published' }).eq('id', campaignId);
  return r;
}

/**
 * Scheduler tick: refresh pricing, then publish any due scheduled posts
 * (scheduled_for <= now). Marks the parent campaign published when a post goes out.
 */
export async function runSchedulerTick(db: SupabaseClient) {
  const pricing = await refreshPricing(db);
  const nowIso = new Date().toISOString();
  const { data: due } = await db
    .from('facebook_posts')
    .select('id, campaign_id')
    .eq('status', 'scheduled')
    .lte('scheduled_for', nowIso);

  const published: { id: string; ok: boolean; error?: string }[] = [];
  for (const p of due ?? []) {
    const r = await publishPost(db, (p as any).id);
    if (r.ok && (p as any).campaign_id) {
      await db.from('campaigns').update({ status: 'published' }).eq('id', (p as any).campaign_id);
    }
    published.push({ id: (p as any).id, ok: r.ok, error: r.error });
  }
  return { pricing, publishedCount: published.filter((p) => p.ok).length, attempted: published.length, published };
}
