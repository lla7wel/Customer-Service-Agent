/**
 * Owner analytics — computed ONLY from real local data. Provider insights are
 * added only when the API genuinely returns them; nothing is fabricated and
 * missing data is shown as missing (never a fake zero).
 */
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';

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
}
