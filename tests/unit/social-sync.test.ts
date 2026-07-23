import { describe, it, expect } from 'vitest';
import { normalizeFacebookPost, normalizeInstagramMedia, normalizeComment } from '../../integrations/pipelines/social-sync';

describe('social post normalization', () => {
  it('normalizes a Facebook photo post with engagement + media', () => {
    const raw = {
      id: '123_456', message: 'طقم مفارش جديد', created_time: '2026-07-10T08:00:00+0000',
      permalink_url: 'https://facebook.com/123_456', status_type: 'added_photos',
      attachments: { data: [{ media_type: 'photo', type: 'photo', media: { image: { src: 'https://cdn/p.jpg' } } }] },
      comments: { summary: { total_count: 4 } }, reactions: { summary: { total_count: 12 } },
    };
    const p = normalizeFacebookPost(raw, 'PAGE1')!;
    expect(p.platform).toBe('facebook');
    expect(p.provider_post_id).toBe('123_456');
    expect(p.caption).toBe('طقم مفارش جديد');
    expect(p.media_url).toBe('https://cdn/p.jpg');
    expect(p.permalink).toBe('https://facebook.com/123_456');
    expect(p.provider_created_at).toBe('2026-07-10T08:00:00.000Z');
    expect(p.engagement).toEqual({ comments: 4, reactions: 12 });
  });

  it('normalizes an Instagram carousel with children', () => {
    const raw = {
      id: 'IG9', caption: 'تخفيضات', media_type: 'CAROUSEL_ALBUM', permalink: 'https://instagram.com/p/IG9',
      timestamp: '2026-07-11T09:00:00+0000', like_count: 30, comments_count: 5,
      children: { data: [{ media_url: 'https://cdn/1.jpg', media_type: 'IMAGE' }, { media_url: 'https://cdn/2.jpg', media_type: 'IMAGE' }] },
    };
    const p = normalizeInstagramMedia(raw, 'IGUSER')!;
    expect(p.platform).toBe('instagram');
    expect(p.media_type).toBe('carousel_album');
    expect(p.media).toHaveLength(2);
    expect(p.media_url).toBe('https://cdn/1.jpg');
    expect(p.engagement).toEqual({ comments: 5, likes: 30 });
  });

  it('returns null for a post without an id', () => {
    expect(normalizeFacebookPost({ message: 'x' }, 'P')).toBeNull();
    expect(normalizeInstagramMedia({}, 'I')).toBeNull();
  });

  it('normalizes a comment from either platform shape', () => {
    const fb = normalizeComment({ id: 'c1', message: 'بكم؟', from: { id: 'u1', name: 'سارة' }, created_time: '2026-07-10T10:00:00+0000' }, 'facebook')!;
    expect(fb).toMatchObject({ provider_comment_id: 'c1', author_name: 'سارة', author_external_id: 'u1', body: 'بكم؟' });
    const ig = normalizeComment({ id: 'c2', text: 'حلو', username: 'nour', timestamp: '2026-07-10T10:00:00+0000', parent: { id: 'p1' } }, 'instagram')!;
    expect(ig).toMatchObject({ provider_comment_id: 'c2', author_name: 'nour', body: 'حلو', parent_comment_id: 'p1' });
  });
});
