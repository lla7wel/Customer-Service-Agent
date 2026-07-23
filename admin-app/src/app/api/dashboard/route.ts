import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/api';
import { sql } from 'kysely';
import { getAnalytics } from '@integrations/pipelines/analytics-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Owner dashboard data — REAL local data only, sourced from the ONE shared
 * analytics service (identical numbers to the Dashboard server page and the
 * Analytics workspace; no drift). Provider insights appear only when actually
 * fetched; otherwise the response says they are unavailable rather than showing
 * fabricated zeroes.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db } = auth.ctx;
  const days = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get('days') ?? 7)));

  const analytics = await getAnalytics(db, { days });

  const [attention, jobsHealth, recentErrors, topProducts, contentSummary] = await Promise.all([
    db.selectFrom('conversations')
      .select((eb) => [eb.fn.countAll<number>().as('n')])
      .where('human_attention', '=', true)
      .executeTakeFirst(),
    db.selectFrom('jobs')
      .select(['status', db.fn.countAll<number>().as('n')])
      .groupBy('status')
      .execute(),
    db.selectFrom('outbox_messages')
      .select(['status', db.fn.countAll<number>().as('n')])
      .where('status', 'in', ['failed', 'uncertain', 'dead'])
      .groupBy('status')
      .execute(),
    sql<{ product_id: string; name: string | null; hits: number }>`
      select p.id as product_id,
             coalesce(p.libyan_display_name, p.arabic_name, p.english_name) as name,
             count(*)::int as hits
        from customer_memory cm,
             jsonb_array_elements(cm.recent_products) as rp(elem)
        join products p on p.id = (rp.elem->>'product_id')::uuid
       where cm.updated_at > now() - make_interval(days => ${days})
       group by p.id, name
       order by hits desc
       limit 8
    `.execute(db).then((r) => r.rows).catch(() => []),
    db.selectFrom('content_items')
      .select(['status', db.fn.countAll<number>().as('n')])
      .where('status', 'in', ['scheduled', 'publishing', 'published', 'partially_published', 'failed'])
      .groupBy('status')
      .execute(),
  ]);

  return NextResponse.json({
    analytics,
    attention_count: Number(attention?.n ?? 0),
    jobs: Object.fromEntries(jobsHealth.map((j) => [j.status, Number(j.n)])),
    delivery_problems: Object.fromEntries(recentErrors.map((r) => [r.status, Number(r.n)])),
    top_products: topProducts,
    content: Object.fromEntries(contentSummary.map((c) => [c.status, Number(c.n)])),
    analytics_computed_at: analytics.meta.generatedAt,
    provider_insights: {
      available: analytics.provider.some((p) => p.available),
      insights: analytics.provider,
      last_synced_at: analytics.meta.providerLastSyncedAt,
      note: analytics.provider.some((p) => p.available)
        ? null
        : 'Facebook/Instagram reach and engagement appear here once the Page token has read_insights and the readiness check passes.',
    },
  });
}
