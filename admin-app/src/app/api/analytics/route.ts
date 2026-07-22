import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/api';
import { getAnalytics, type Channel } from '@integrations/pipelines/analytics-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHANNELS: Channel[] = ['all', 'messenger', 'instagram'];

/**
 * Analytics workspace data (Owner + Analyzer — enforced centrally in
 * requireAdminApi). Truthful, Tripoli-day-aligned, zero-filled, with an
 * equal-length previous-period comparison and provider metadata.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db } = auth.ctx;

  const params = req.nextUrl.searchParams;
  const start = params.get('start');
  const end = params.get('end');
  const channelParam = params.get('channel');
  const channel: Channel = CHANNELS.includes(channelParam as Channel) ? (channelParam as Channel) : 'all';

  const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const range = isDay(start) && isDay(end) && start <= end ? { start, end } : undefined;
  const days = Math.min(90, Math.max(7, Number(params.get('days') ?? 30)));

  const analytics = await getAnalytics(db, range ? { range, channel } : { days, channel });
  return NextResponse.json(analytics);
}
