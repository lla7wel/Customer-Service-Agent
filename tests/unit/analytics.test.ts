import { describe, expect, it } from 'vitest';
import { analyticsDayKey, providerInsightRows } from '../../integrations/pipelines/analytics';

describe('provider insights normalization', () => {
  it('normalizes both PostgreSQL Date objects and ISO date strings', () => {
    expect(analyticsDayKey(new Date('2026-07-21T00:00:00.000Z'))).toBe('2026-07-21');
    expect(analyticsDayKey('2026-07-20')).toBe('2026-07-20');
    expect(analyticsDayKey('not-a-date')).toBeNull();
  });

  it('keeps only real numeric provider values with their source day', () => {
    expect(providerInsightRows([
      { name: 'page_post_engagements', values: [{ value: 12, end_time: '2026-07-20T07:00:00+0000' }] },
      { name: 'reach', values: [{ value: 81, end_time: '2026-07-20T07:00:00+0000' }] },
      { name: 'unknown_metric', values: [{ value: 999, end_time: '2026-07-20T07:00:00+0000' }] },
      { name: 'views', values: [{ value: 'not-a-number', end_time: '2026-07-20T07:00:00+0000' }] },
    ])).toEqual([
      { day: '2026-07-20', metric: 'facebook_page_engagements', value: 12 },
      { day: '2026-07-20', metric: 'instagram_reach', value: 81 },
    ]);
  });
});
