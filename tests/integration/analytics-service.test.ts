import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDatabase, seedConversation, type TestDb } from './setup';
import { getAnalytics } from '../../integrations/pipelines/analytics-query';

/**
 * Proves the shared analytics service is correct against a real database:
 * Tripoli-day bucketing, zero-filled aligned series, equal-length previous
 * period, and Instagram reach treated as NON-additive.
 */
describe('shared analytics service', () => {
  let t: TestDb;
  let convId: string;

  beforeAll(async () => {
    t = await createTestDatabase('eh_analytics');
    const seeded = await seedConversation(t.db, 'messenger');
    convId = seeded.conversationId;

    // Inbound messages straddling a Tripoli day boundary (UTC+2):
    //  - 21:00Z on the 22nd  → 23:00 Tripoli, still the 22nd
    //  - 22:30Z on the 22nd  → 00:30 Tripoli, now the 23rd
    // Under UTC grouping both would land on the 22nd; under Tripoli they split.
    const inbound = async (iso: string) => {
      await t.db.insertInto('messages').values({
        conversation_id: convId, direction: 'inbound' as any, sender_type: 'customer' as any,
        body: 'hi', created_at: iso as any,
      }).execute();
    };
    await inbound('2026-07-22T21:00:00Z'); // Tripoli 22nd
    await inbound('2026-07-22T22:30:00Z'); // Tripoli 23rd
    await inbound('2026-07-20T09:00:00Z'); // previous period (Tripoli 20th)

    // Provider rows: reach is unique (non-additive), engagement is additive.
    const prov = async (day: string, metric: string, value: number) => {
      await t.db.insertInto('analytics_daily').values({ day: day as any, metric, value }).execute();
    };
    await prov('2026-07-22', 'instagram_reach', 100);
    await prov('2026-07-23', 'instagram_reach', 120);
    await prov('2026-07-22', 'facebook_page_engagements', 10);
    await prov('2026-07-23', 'facebook_page_engagements', 20);
  });

  afterAll(async () => { await t.destroy(); });

  it('buckets inbound messages by Tripoli calendar day (not UTC), aligned + zero-filled', async () => {
    const a = await getAnalytics(t.db, { range: { start: '2026-07-22', end: '2026-07-23' } });
    const s = a.metrics.inbound_messages;
    expect(s.days).toEqual(['2026-07-22', '2026-07-23']);
    // One message each day under Tripoli bucketing (UTC would give [2, 0]).
    expect(s.values).toEqual([1, 1]);
    expect(s.total).toBe(2);
  });

  it('fills every day in the range even with no activity', async () => {
    const a = await getAnalytics(t.db, { range: { start: '2026-07-24', end: '2026-07-26' } });
    const s = a.metrics.inbound_messages;
    expect(s.days).toEqual(['2026-07-24', '2026-07-25', '2026-07-26']);
    expect(s.values).toEqual([0, 0, 0]); // explicit zeros, never missing keys
  });

  it('compares against the equal-length previous period', async () => {
    const a = await getAnalytics(t.db, { range: { start: '2026-07-22', end: '2026-07-23' } });
    // Previous period is 2026-07-20..21, which has exactly one inbound message.
    expect(a.previous).toEqual({ start: '2026-07-20', end: '2026-07-21' });
    expect(a.metrics.inbound_messages.previousTotal).toBe(1);
    expect(a.metrics.inbound_messages.changePct).toBe(100); // 2 vs 1
  });

  it('never sums Instagram reach into a period total; sums additive engagement', async () => {
    const a = await getAnalytics(t.db, { range: { start: '2026-07-22', end: '2026-07-23' } });
    const reach = a.provider.find((p) => p.metric === 'instagram_reach')!;
    expect(reach.available).toBe(true);
    expect(reach.kind).toBe('unique');
    expect(reach.values).toEqual([100, 120]); // daily trend preserved
    expect(reach.total).toBeNull();            // NOT 220 — reach is not additive

    const eng = a.provider.find((p) => p.metric === 'facebook_page_engagements')!;
    expect(eng.total).toBe(30); // additive → summed
  });

  it('reports provider metrics as unavailable rather than fake zeroes when absent', async () => {
    const a = await getAnalytics(t.db, { range: { start: '2026-08-01', end: '2026-08-02' } });
    const reach = a.provider.find((p) => p.metric === 'instagram_reach')!;
    expect(reach.available).toBe(false);
    expect(reach.total).toBeNull();
  });

  it('is deterministic — identical inputs give identical numbers (no drift between callers)', async () => {
    const range = { start: '2026-07-22', end: '2026-07-23' } as const;
    const a = await getAnalytics(t.db, { range });
    const b = await getAnalytics(t.db, { range });
    expect(a.metrics.inbound_messages.values).toEqual(b.metrics.inbound_messages.values);
    expect(a.metrics.inbound_messages.total).toEqual(b.metrics.inbound_messages.total);
  });

  it('filters messaging metrics by channel', async () => {
    const all = await getAnalytics(t.db, { range: { start: '2026-07-22', end: '2026-07-23' }, channel: 'all' });
    const ig = await getAnalytics(t.db, { range: { start: '2026-07-22', end: '2026-07-23' }, channel: 'instagram' });
    expect(all.metrics.inbound_messages.total).toBe(2);
    expect(ig.metrics.inbound_messages.total).toBe(0); // the seeded conversation is messenger
  });
});
