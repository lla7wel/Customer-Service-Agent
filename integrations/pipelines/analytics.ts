/**
 * Owner analytics — computed ONLY from real local data. Provider insights are
 * added only when the API genuinely returns them; nothing is fabricated and
 * missing data is shown as missing (never a fake zero).
 */
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';
import { graphCall, igUserId, pageId, pageAccessToken } from '../providers/graph';

interface ProviderMetric {
  name?: string;
  values?: Array<{ value?: unknown; end_time?: string }>;
}

const PROVIDER_METRIC_NAMES: Record<string, string> = {
  page_post_engagements: 'facebook_page_engagements',
  page_views_total: 'facebook_page_views',
  reach: 'instagram_reach',
  views: 'instagram_views',
  total_interactions: 'instagram_interactions',
};

export function providerInsightRows(data: ProviderMetric[] | undefined): { day: string; metric: string; value: number }[] {
  const rows: { day: string; metric: string; value: number }[] = [];
  for (const series of data ?? []) {
    const metric = series.name ? PROVIDER_METRIC_NAMES[series.name] : undefined;
    if (!metric) continue;
    for (const point of series.values ?? []) {
      const value = Number(point.value);
      if (!point.end_time || !Number.isFinite(value)) continue;
      rows.push({ day: point.end_time.slice(0, 10), metric, value });
    }
  }
  return rows;
}

async function refreshProviderInsights(
  db: Kysely<DB>,
  upsert: (rows: { day: string; metric: string; value: number }[]) => Promise<void>,
  days: number,
): Promise<void> {
  if (!pageAccessToken() || !pageId()) return;
  const readiness = await db.selectFrom('provider_readiness').select('ok').where('check_key', '=', 'insights').executeTakeFirst();
  if (!readiness?.ok) return;
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 24 * 60 * 60;

  const page = await graphCall<{ data?: ProviderMetric[] }>(`${pageId()}/insights`, {
    params: { metric: 'page_post_engagements,page_views_total', period: 'day', since, until },
    retries: 1,
  }).catch(() => null);
  if (page?.data) await upsert(providerInsightRows(page.data));

  if (!igUserId()) return;
  const instagram = await graphCall<{ data?: ProviderMetric[] }>(`${igUserId()}/insights`, {
    params: { metric: 'reach,views,total_interactions', period: 'day', since, until },
    retries: 1,
  }).catch(() => null);
  if (instagram?.data) await upsert(providerInsightRows(instagram.data));
}

/** Recompute daily rollups for the last `days` days (idempotent upserts). */
export async function refreshAnalytics(db: Kysely<DB>, days = 14): Promise<void> {
  const upsert = async (rows: { day: string; metric: string; value: number }[]) => {
    for (const r of rows) {
      await db
        .insertInto('analytics_daily')
        .values({ day: r.day, metric: r.metric, value: r.value, computed_at: new Date().toISOString() })
        .onConflict((oc) => oc.columns(['day', 'metric']).doUpdateSet({ value: r.value, computed_at: new Date().toISOString() }))
        .execute();
    }
  };

  const daily = async (query: string, metric: string) => {
    const res = await sql<{ day: string; n: number }>`${sql.raw(query.replace('__DAYS__', String(days)))}`.execute(db);
    await upsert(res.rows.map((r) => ({ day: String(r.day).slice(0, 10), metric, value: Number(r.n) })));
  };

  await daily(`
    select date(created_at) as day, count(*) as n from messages
    where direction = 'inbound' and created_at > now() - interval '__DAYS__ days'
    group by 1`, 'inbound_messages');

  await daily(`
    select date(created_at) as day, count(*) as n from messages
    where direction = 'outbound' and sender_type = 'ai' and delivery_status in ('sent','partial')
      and created_at > now() - interval '__DAYS__ days'
    group by 1`, 'ai_replies');

  await daily(`
    select date(created_at) as day, count(*) as n from messages
    where direction = 'outbound' and sender_type = 'human'
      and created_at > now() - interval '__DAYS__ days'
    group by 1`, 'human_replies');

  await daily(`
    select date(last_message_at) as day, count(distinct id) as n from conversations
    where last_message_at > now() - interval '__DAYS__ days'
    group by 1`, 'active_conversations');

  await daily(`
    select date(handoff_sent_at) as day, count(*) as n from conversations
    where handoff_sent_at > now() - interval '__DAYS__ days'
    group by 1`, 'order_handoffs');

  await daily(`
    select date(human_attention_at) as day, count(*) as n from conversations
    where human_attention_at > now() - interval '__DAYS__ days'
    group by 1`, 'human_attention_flags');

  await daily(`
    select date(published_at) as day, count(*) as n from content_publications
    where status = 'published' and published_at > now() - interval '__DAYS__ days'
    group by 1`, 'content_published');

  await daily(`
    select date(updated_at) as day, count(*) as n from content_publications
    where status = 'failed' and updated_at > now() - interval '__DAYS__ days'
    group by 1`, 'content_failed');

  await daily(`
    select date(updated_at) as day, count(*) as n from content_comments
    where reply_status = 'sent' and updated_at > now() - interval '__DAYS__ days'
    group by 1`, 'comment_replies');

  await daily(`
    select date(updated_at) as day, count(*) as n from content_comments
    where reply_status = 'failed' and updated_at > now() - interval '__DAYS__ days'
    group by 1`, 'comment_reply_failures');

  // Provider analytics are read only after a real readiness check proves the
  // token has Insights access. Missing permission remains missing—not fake 0.
  await refreshProviderInsights(db, upsert, days);
}
