import { describe, it, expect } from 'vitest';
import {
  addDays, dayList, previousRange, rangeForDays, zeroFill, pctChange, dayKey, tripoliToday,
} from '../../integrations/pipelines/analytics-query';

describe('analytics date helpers', () => {
  it('addDays crosses month/year boundaries', () => {
    expect(addDays('2026-07-22', 1)).toBe('2026-07-23');
    expect(addDays('2026-07-01', -1)).toBe('2026-06-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('rangeForDays yields an inclusive N-day window ending today (Tripoli)', () => {
    const now = new Date('2026-07-22T23:30:00Z'); // 01:30 Tripoli next day (UTC+2)
    const r = rangeForDays(7, now);
    expect(r.end).toBe('2026-07-23'); // Tripoli calendar day
    expect(dayList(r)).toHaveLength(7);
    expect(dayList(r)[0]).toBe('2026-07-17');
  });

  it('tripoliToday uses the Africa/Tripoli calendar day, not UTC', () => {
    // 22:30 UTC is already 00:30 the NEXT day in Tripoli (UTC+2).
    expect(tripoliToday(new Date('2026-07-22T22:30:00Z'))).toBe('2026-07-23');
    // 21:30 UTC is still the same day in Tripoli (23:30).
    expect(tripoliToday(new Date('2026-07-22T21:30:00Z'))).toBe('2026-07-22');
  });

  it('previousRange is the equal-length window immediately before', () => {
    const r = { start: '2026-07-17', end: '2026-07-23' }; // 7 days
    const p = previousRange(r);
    expect(p).toEqual({ start: '2026-07-10', end: '2026-07-16' });
    expect(dayList(p)).toHaveLength(dayList(r).length);
  });

  it('dayList is ascending, inclusive and aligned', () => {
    expect(dayList({ start: '2026-07-20', end: '2026-07-22' })).toEqual(['2026-07-20', '2026-07-21', '2026-07-22']);
  });

  it('zeroFill aligns a sparse map onto the full day list (fills gaps with 0)', () => {
    const days = ['2026-07-20', '2026-07-21', '2026-07-22'];
    const sparse = new Map([['2026-07-20', 5], ['2026-07-22', 3]]);
    expect(zeroFill(days, sparse)).toEqual([5, 0, 3]);
  });

  it('pctChange distinguishes "no baseline" (null) from a real 0% change', () => {
    expect(pctChange(10, 5)).toBe(100);
    expect(pctChange(5, 10)).toBe(-50);
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(7, 0)).toBeNull(); // new activity, no prior baseline
  });

  it('dayKey normalizes Date and string forms', () => {
    expect(dayKey('2026-07-22')).toBe('2026-07-22');
    expect(dayKey('2026-07-22T10:00:00Z')).toBe('2026-07-22');
    expect(dayKey(new Date('2026-07-22T00:00:00Z'))).toBe('2026-07-22');
    expect(dayKey('nonsense')).toBeNull();
  });
});
