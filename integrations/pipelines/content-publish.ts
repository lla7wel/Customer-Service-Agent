/**
 * Content publishing — exactly-once, resumable, truthful (EH-007/029/030).
 *
 *   * one content_publications row per (item, platform) with an idempotency
 *     key and a conditional claim, so retries/reloads/concurrent workers can
 *     never create duplicate Facebook or Instagram posts;
 *   * multi-step provider flows persist child media ids (provider_children)
 *     and resume from them instead of re-uploading;
 *   * the parent item's status is always DERIVED from all publications:
 *     published / partially_published / failed — never optimistic;
 *   * price drops activate their prices exactly once, on the FIRST successful
 *     platform publication; a fully-failed publish never changes a price.
 */
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';
import {
  fbPublishSinglePhoto, fbUploadUnpublishedPhoto, fbPublishCarousel, fbPublishPhotoStory,
  igCreateContainer, igCreateCarouselContainer, igPublishContainer, igMediaPermalink,
} from '../providers/publishing';
import { MetaApiError } from '../providers/graph';
import { activatePriceDrop } from '../catalog/pricing';
import { enqueue } from '../jobs/queue';

const json = (v: unknown) => JSON.stringify(v ?? []);

/**
 * Transition an approved item into publishing: create its publication rows
 * (idempotent) and enqueue one delivery job per platform. Used by the approve
 * API (immediate) and the scheduler tick (due scheduled items).
 */
export async function startPublishing(db: Kysely<DB>, contentItemId: string): Promise<{ started: boolean; publicationIds: string[] }> {
  return db.transaction().execute(async (trx) => {
    const item = await trx
      .selectFrom('content_items')
      .select(['id', 'status', 'platforms', 'content_type'])
      .where('id', '=', contentItemId)
      .forUpdate()
      .executeTakeFirst();
    if (!item) return { started: false, publicationIds: [] };
    if (!['approved', 'scheduled', 'publishing'].includes(item.status)) {
      return { started: false, publicationIds: [] };
    }
    const assetCount = await trx
      .selectFrom('content_assets')
      .select(trx.fn.countAll<number>().as('n'))
      .where('content_item_id', '=', contentItemId)
      .executeTakeFirst();
    if (!Number(assetCount?.n ?? 0)) {
      await trx.updateTable('content_items')
        .set({ status: 'failed', last_error: 'no assets to publish' })
        .where('id', '=', contentItemId).execute();
      return { started: false, publicationIds: [] };
    }

    await trx.updateTable('content_items').set({ status: 'publishing' }).where('id', '=', contentItemId).execute();

    const platforms = (item.platforms ?? []).filter((p) => p === 'facebook' || p === 'instagram');
    const format = item.content_type === 'story' ? 'story' : (Number(assetCount?.n) > 1 ? 'carousel' : 'feed');
    const publicationIds: string[] = [];
    for (const platform of platforms) {
      const existing = await trx
        .selectFrom('content_publications')
        .select(['id', 'status'])
        .where('content_item_id', '=', contentItemId)
        .where('platform', '=', platform)
        .executeTakeFirst();
      if (existing) {
        if (['pending', 'publishing', 'uncertain'].includes(existing.status)) publicationIds.push(existing.id);
        continue;
      }
      const row = await trx
        .insertInto('content_publications')
        .values({
          content_item_id: contentItemId,
          platform,
          format,
          idempotency_key: `pub:${contentItemId}:${platform}`,
          status: 'pending',
        })
        .returning('id')
        .executeTakeFirst();
      if (row) publicationIds.push(row.id);
    }
    for (const id of publicationIds) {
      await enqueue(trx, { jobType: 'content_publish', payload: { publicationId: id }, dedupeKey: `content_publish:${id}`, maxAttempts: 5, priority: 60 });
    }
    return { started: publicationIds.length > 0, publicationIds };
  });
}

/** Retry ONLY the failed platform of a partially-published item (admin action). */
export async function retryPublication(db: Kysely<DB>, publicationId: string): Promise<boolean> {
  const res = await sql`
    update content_publications
       set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null
     where id = ${publicationId} and status in ('failed','uncertain','cancelled')
  `.execute(db);
  if (!Number(res.numAffectedRows ?? 0)) return false;
  const pub = await db.selectFrom('content_publications').select('content_item_id').where('id', '=', publicationId).executeTakeFirst();
  if (pub) await db.updateTable('content_items').set({ status: 'publishing' }).where('id', '=', pub.content_item_id).execute();
  await enqueue(db, { jobType: 'content_publish', payload: { publicationId }, dedupeKey: `content_publish:${publicationId}`, maxAttempts: 5, priority: 60 });
  return true;
}

export type PublishOutcome = 'published' | 'retry' | 'failed' | 'skipped';

/** Worker handler: publish ONE publication (one platform of one item). */
export async function processPublication(db: Kysely<DB>, publicationId: string): Promise<PublishOutcome> {
  // Claim (pending → publishing). A crashed 'publishing' row is also
  // claimable: provider_children lets it resume without duplicate uploads.
  const claimed = await sql<any>`
    update content_publications
       set status = 'publishing', attempts = attempts + 1
     where id = ${publicationId} and status in ('pending','publishing')
    returning *
  `.execute(db);
  const pub = claimed.rows[0];
  if (!pub) return 'skipped';

  const item = await db
    .selectFrom('content_items')
    .selectAll()
    .where('id', '=', pub.content_item_id)
    .executeTakeFirst();
  if (!item) return 'skipped';

  const assets = await db
    .selectFrom('content_assets')
    .select(['id', 'public_url', 'position'])
    .where('content_item_id', '=', item.id)
    .orderBy('position', 'asc')
    .execute();
  const urls = assets.map((a) => a.public_url).filter((u): u is string => !!u && /^https:\/\//.test(u));
  if (!urls.length) {
    await markPublicationFailed(db, pub, 'no publishable HTTPS asset URLs');
    return 'failed';
  }

  const children: string[] = Array.isArray(pub.provider_children) ? [...pub.provider_children] : [];
  const persistChildren = async () => {
    await db.updateTable('content_publications')
      .set({ provider_children: json(children) })
      .where('id', '=', publicationId).execute();
  };

  try {
    let providerPostId: string | null = null;
    let permalink: string | null = null;

    if (pub.platform === 'facebook') {
      if (pub.format === 'story') {
        // Each asset becomes a distinct story frame; resume skips done frames.
        for (let i = 0; i < urls.length; i++) {
          if (children[i]) continue;
          const photoId = await fbUploadUnpublishedPhoto(urls[i]);
          const res = await fbPublishPhotoStory({ photoId });
          children[i] = res.providerPostId ?? photoId;
          providerPostId = providerPostId ?? children[i];
          await persistChildren();
        }
        providerPostId = providerPostId ?? children.find(Boolean) ?? null;
      } else if (pub.format === 'carousel') {
        for (let i = 0; i < urls.length; i++) {
          if (children[i]) continue;
          children[i] = await fbUploadUnpublishedPhoto(urls[i]);
          await persistChildren();
        }
        const res = await fbPublishCarousel({ childIds: children.filter(Boolean), caption: item.caption ?? '' });
        providerPostId = res.providerPostId;
      } else {
        const res = await fbPublishSinglePhoto({ imageUrl: urls[0], caption: item.caption ?? '' });
        providerPostId = res.providerPostId;
      }
    } else {
      // Instagram
      if (pub.format === 'story') {
        for (let i = 0; i < urls.length; i++) {
          if (children[i]) continue;
          const containerId = await igCreateContainer({ imageUrl: urls[i], isStory: true });
          const res = await igPublishContainer(containerId);
          children[i] = res.providerPostId ?? containerId;
          providerPostId = providerPostId ?? children[i];
          await persistChildren();
        }
        providerPostId = providerPostId ?? children.find(Boolean) ?? null;
      } else if (pub.format === 'carousel') {
        for (let i = 0; i < urls.length; i++) {
          if (children[i]) continue;
          children[i] = await igCreateContainer({ imageUrl: urls[i], isCarouselItem: true });
          await persistChildren();
        }
        const carousel = await igCreateCarouselContainer({ childIds: children.filter(Boolean), caption: item.caption ?? '' });
        const res = await igPublishContainer(carousel);
        providerPostId = res.providerPostId;
      } else {
        const containerId = children[0] ?? await igCreateContainer({ imageUrl: urls[0], caption: item.caption ?? '' });
        children[0] = containerId;
        await persistChildren();
        const res = await igPublishContainer(containerId);
        providerPostId = res.providerPostId;
      }
      if (providerPostId) permalink = await igMediaPermalink(providerPostId);
    }

    await db.updateTable('content_publications')
      .set({
        status: 'published',
        provider_post_id: providerPostId,
        permalink_url: permalink,
        provider_children: json(children),
        published_at: new Date().toISOString(),
        last_error: null,
      })
      .where('id', '=', publicationId)
      .execute();

    await activatePricesOnFirstSuccess(db, item);
    await recomputeItemStatus(db, item.id);
    return 'published';
  } catch (e: any) {
    const transient = e instanceof MetaApiError ? e.transient : true;
    const exhausted = (pub.attempts ?? 0) >= (pub.max_attempts ?? 4);
    await persistChildren(); // keep whatever we managed to create for resume
    if (transient && !exhausted) {
      const backoffSeconds = Math.min(900, 30 * 2 ** Math.max(0, (pub.attempts ?? 1) - 1));
      await sql`
        update content_publications
           set status = 'pending',
               last_error = ${String(e?.message ?? 'publish failed').slice(0, 500)},
               next_attempt_at = now() + make_interval(secs => ${backoffSeconds})
         where id = ${publicationId}
      `.execute(db);
      await recomputeItemStatus(db, item.id);
      return 'retry';
    }
    await markPublicationFailed(db, pub, String(e?.message ?? 'publish failed'));
    return 'failed';
  }
}

async function markPublicationFailed(db: Kysely<DB>, pub: any, error: string): Promise<void> {
  await db.updateTable('content_publications')
    .set({ status: 'failed', last_error: error.slice(0, 500) })
    .where('id', '=', pub.id)
    .execute();
  await recomputeItemStatus(db, pub.content_item_id);
}

/** Price drops activate on the FIRST successful platform. Idempotent. */
async function activatePricesOnFirstSuccess(db: Kysely<DB>, item: any): Promise<void> {
  if (item.purpose !== 'price_drop') return;
  const products = await db
    .selectFrom('content_products')
    .select(['product_id', 'new_price'])
    .where('content_item_id', '=', item.id)
    .where('new_price', 'is not', null)
    .execute();
  for (const p of products) {
    await activatePriceDrop(db, {
      contentItemId: item.id,
      productId: p.product_id,
      newPrice: Number(p.new_price),
      endsAt: item.promotion_ends_at ?? null,
      adminId: item.approved_by ?? null,
    });
  }
}

/** Parent status is always derived from ALL its publications — never assumed. */
export async function recomputeItemStatus(db: Kysely<DB>, contentItemId: string): Promise<void> {
  const pubs = await db
    .selectFrom('content_publications')
    .select(['status'])
    .where('content_item_id', '=', contentItemId)
    .execute();
  if (!pubs.length) return;
  const states = pubs.map((p) => p.status);
  const published = states.filter((s) => s === 'published').length;
  const inFlight = states.some((s) => s === 'pending' || s === 'publishing' || s === 'uncertain');
  let status: string;
  if (published === states.length) status = 'published';
  else if (inFlight) status = 'publishing';
  else if (published > 0) status = 'partially_published';
  else status = 'failed';
  await db.updateTable('content_items')
    .set({ status: status as any })
    .where('id', '=', contentItemId)
    .where('status', 'in', ['publishing', 'partially_published', 'failed', 'published'])
    .execute();
}

/** Scheduler tick: move due scheduled items into publishing (Africa/Tripoli
 *  times are converted to UTC when the schedule is saved). */
export async function startDueScheduledContent(db: Kysely<DB>): Promise<number> {
  const due = await db
    .selectFrom('content_items')
    .select('id')
    .where('status', '=', 'scheduled')
    .where('scheduled_for', 'is not', null)
    .where('scheduled_for', '<=', new Date().toISOString())
    .execute();
  let started = 0;
  for (const item of due) {
    const res = await startPublishing(db, item.id);
    if (res.started) started++;
  }
  return started;
}
