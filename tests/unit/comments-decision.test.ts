import { describe, expect, it } from 'vitest';
import { decideCommentReply, buildPriceReply, buildDmReply } from '../../integrations/pipelines/comments';
import type { ProviderComment } from '../../integrations/providers/publishing';

const comment = (over: Partial<ProviderComment> = {}): ProviderComment => ({
  id: 'c1', text: 'بكم هذا؟', authorName: 'Test', authorId: 'u1',
  createdTime: new Date().toISOString(), parentId: null, fromSelf: false, ...over,
});

const base = {
  publicationPublishedAt: new Date(Date.now() - 3600_000).toISOString(),
  automationEnabled: true,
};

describe('decideCommentReply', () => {
  it('replies with the EXACT price only for one product with a verified active price', () => {
    const d = decideCommentReply({ ...base, comment: comment(), linkedProducts: [{ name: 'طقم', price: 189 }] });
    expect(d.decision).toBe('reply_price');
    expect(d.replyText).toBe(buildPriceReply(189));
    expect(d.replyText).toContain('189');
  });

  it('multiple products → DM invitation, never a guess', () => {
    const d = decideCommentReply({
      ...base, comment: comment(),
      linkedProducts: [{ name: 'أ', price: 100 }, { name: 'ب', price: 120 }],
    });
    expect(d.decision).toBe('reply_dm');
    expect(d.replyText).toBe(buildDmReply());
  });

  it('missing price → DM invitation, never a guess', () => {
    const d = decideCommentReply({ ...base, comment: comment(), linkedProducts: [{ name: 'أ', price: null }] });
    expect(d.decision).toBe('reply_dm');
  });

  it('order/complaint comments → public DM invite + human attention', () => {
    const d = decideCommentReply({ ...base, comment: comment({ text: 'نبي نطلب منه' }), linkedProducts: [{ name: 'أ', price: 100 }] });
    expect(d.decision).toBe('human_attention');
    expect(d.replyText).toBe(buildDmReply());
  });

  it('never replies to our own comments', () => {
    const d = decideCommentReply({ ...base, comment: comment({ fromSelf: true }), linkedProducts: [] });
    expect(d.decision).toBe('skip_own');
    expect(d.replyText).toBeNull();
  });

  it('never answers old comments', () => {
    const d = decideCommentReply({
      ...base,
      comment: comment({ createdTime: new Date(Date.now() - 10 * 24 * 3600_000).toISOString() }),
      linkedProducts: [{ name: 'أ', price: 100 }],
    });
    expect(d.decision).toBe('skip_old');
  });

  it('never replies when automation is disabled for the item', () => {
    const d = decideCommentReply({ ...base, automationEnabled: false, comment: comment(), linkedProducts: [{ name: 'أ', price: 100 }] });
    expect(d.decision).toBe('skip_disabled');
  });
});
