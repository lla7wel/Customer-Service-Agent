import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDatabase, seedProduct, type TestDb } from './setup';
import { claimComment, manualReplyToComment } from '../../integrations/pipelines/comment-ledger';
import { upsertSocialPost, upsertSocialComment } from '../../integrations/pipelines/social-sync';

describe('shared comment reply ledger', () => {
  let t: TestDb;

  beforeAll(async () => { t = await createTestDatabase('eh_ledger'); });
  afterAll(async () => { await t.destroy(); });

  async function seedExternalComment(): Promise<{ postId: string; commentId: string }> {
    const postId = await upsertSocialPost(t.db, {
      platform: 'facebook', provider_post_id: `ext-${Math.random().toString(36).slice(2)}`, account_id: 'PAGE1',
      post_type: 'photo', caption: 'external', media_type: 'image', media_url: null, media: [], permalink: null,
      provider_created_at: new Date().toISOString(), engagement: { comments: 1 },
    });
    await upsertSocialComment(t.db, postId, {
      provider_comment_id: `c-${Math.random().toString(36).slice(2)}`, parent_comment_id: null,
      author_name: 'زائر', author_external_id: 'u1', body: 'بكم؟', commented_at: new Date().toISOString(),
    });
    const c = await t.db.selectFrom('content_comments').select('id').where('social_post_id', '=', postId).executeTakeFirstOrThrow();
    return { postId, commentId: c.id };
  }

  it('links a post to an app publication when the provider id matches (else external)', async () => {
    const productId = await seedProduct(t.db);
    const item = await t.db.insertInto('content_items').values({ title: 'App post', status: 'published', purpose: 'general' }).returning('id').executeTakeFirstOrThrow();
    await t.db.insertInto('content_products').values({ content_item_id: item.id, product_id: productId, position: 0 }).execute();
    await t.db.insertInto('content_publications').values({
      content_item_id: item.id, platform: 'facebook', format: 'feed', status: 'published',
      idempotency_key: `idem-${item.id}`, provider_post_id: 'APP_POST_1', published_at: new Date().toISOString(),
    }).execute();

    const appPostId = await upsertSocialPost(t.db, {
      platform: 'facebook', provider_post_id: 'APP_POST_1', account_id: 'PAGE1', post_type: 'photo',
      caption: 'from app', media_type: 'image', media_url: null, media: [], permalink: null,
      provider_created_at: new Date().toISOString(), engagement: {},
    });
    const row = await t.db.selectFrom('social_posts').select(['source', 'content_item_id', 'publication_id']).where('id', '=', appPostId).executeTakeFirstOrThrow();
    expect(row.source).toBe('app');
    expect(row.content_item_id).toBe(item.id);
  });

  it('an auto claim is exclusive — a second auto claim gets nothing', async () => {
    const { commentId } = await seedExternalComment();
    expect(await claimComment(t.db, commentId, 'auto', null)).toBeTruthy();
    expect(await claimComment(t.db, commentId, 'auto', null)).toBeNull();
  });

  it('manual takes precedence over an UNSENT auto claim; auto cannot override manual', async () => {
    const { commentId } = await seedExternalComment();
    expect(await claimComment(t.db, commentId, 'auto', null)).toBeTruthy();
    // Manual overrides the unsent auto claim…
    expect(await claimComment(t.db, commentId, 'manual', null)).toBeTruthy();
    // …and auto can no longer take it back.
    expect(await claimComment(t.db, commentId, 'auto', null)).toBeNull();
  });

  it('a sent comment can never be claimed again (idempotent)', async () => {
    const { commentId } = await seedExternalComment();
    await t.db.updateTable('content_comments').set({ reply_status: 'sent' } as any).where('id', '=', commentId).execute();
    expect(await claimComment(t.db, commentId, 'manual', null)).toBeNull();
    expect(await claimComment(t.db, commentId, 'auto', null)).toBeNull();
  });

  it('a manual reply to an already-answered comment reports a conflict, never a duplicate', async () => {
    const { commentId } = await seedExternalComment();
    await t.db.updateTable('content_comments').set({ reply_status: 'sent' } as any).where('id', '=', commentId).execute();
    const res = await manualReplyToComment(t.db, commentId, null, 'رد يدوي');
    expect(res.status).toBe('conflict');
    expect(res.ok).toBe(false);
  });

  it('a failed send releases the claim so it can be retried', async () => {
    const { commentId } = await seedExternalComment();
    // No Meta credentials in tests → the send throws → status 'failed', claim released.
    const res = await manualReplyToComment(t.db, commentId, null, 'رد');
    expect(res.status).toBe('failed');
    const row = await t.db.selectFrom('content_comments').select(['reply_status', 'reply_claimed_at']).where('id', '=', commentId).executeTakeFirstOrThrow();
    expect(row.reply_status).toBe('failed');
    expect(row.reply_claimed_at).toBeNull(); // released for retry
  });
});
