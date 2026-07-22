import Link from 'next/link';
import {
  LayoutDashboard, MessageSquare, Bot, HandHelping, Clapperboard,
  AlertTriangle, Package, Activity, TrendingUp,
} from 'lucide-react';
import { PageHeader, Card, StatCard, SectionTitle, Badge, EmptyState } from '@/components/ui';
import SystemStatus from '@/components/dashboard/SystemStatus';
import NotConnected from '@/components/NotConnected';
import AutoRefresh from '@/components/AutoRefresh';
import { getT } from '@/lib/i18n/server';
import { allIntegrationStatuses, databaseStatus } from '@integrations/status';
import { getDb } from '@/lib/db';
import { sql } from 'kysely';
import { timeAgo } from '@/lib/format';
import { getAnalytics } from '@integrations/pipelines/analytics-query';

export const dynamic = 'force-dynamic';

/** Operational snapshots — current-state counts (not dated series). */
async function liveSnapshots(db: NonNullable<ReturnType<typeof getDb>>) {
  const [attention, failedPubs, deliveryProblems, deadJobs] = await Promise.all([
    db.selectFrom('conversations').select(db.fn.countAll<number>().as('n'))
      .where('human_attention', '=', true).executeTakeFirst(),
    db.selectFrom('content_publications').select(db.fn.countAll<number>().as('n'))
      .where('status', '=', 'failed').executeTakeFirst(),
    db.selectFrom('outbox_messages').select(db.fn.countAll<number>().as('n'))
      .where('status', 'in', ['failed', 'uncertain', 'dead']).executeTakeFirst(),
    db.selectFrom('jobs').select(db.fn.countAll<number>().as('n'))
      .where('status', '=', 'dead').executeTakeFirst(),
  ]);
  return {
    attention: Number(attention?.n ?? 0),
    failedPubs: Number(failedPubs?.n ?? 0),
    deliveryProblems: Number(deliveryProblems?.n ?? 0),
    deadJobs: Number(deadJobs?.n ?? 0),
  };
}

export default async function DashboardPage() {
  const { t, locale } = await getT();
  const ar = locale === 'ar';
  const statuses = allIntegrationStatuses();
  const db = getDb();
  if (!db) {
    return (
      <div>
        <PageHeader icon={LayoutDashboard} title={t('dashboard_title')} subtitle={t('dashboard_subtitle')} />
        <NotConnected status={databaseStatus()} />
      </div>
    );
  }

  const [analytics, counts, topProducts, upcoming, recentAttention, insightsReadiness] = await Promise.all([
    getAnalytics(db, { days: 7 }),
    liveSnapshots(db),
    sql<{ product_id: string; name: string | null; hits: number }>`
      select p.id as product_id,
             coalesce(p.libyan_display_name, p.arabic_name, p.english_name) as name,
             count(*)::int as hits
        from customer_memory cm,
             jsonb_array_elements(cm.recent_products) as rp(elem)
        join products p on p.id = (rp.elem->>'product_id')::uuid
       where cm.updated_at > now() - interval '30 days'
       group by p.id, name
       order by hits desc
       limit 6
    `.execute(db).then((r) => r.rows).catch(() => []),
    db.selectFrom('content_items')
      .select(['id', 'title', 'content_type', 'status', 'scheduled_for', 'platforms'])
      .where('status', 'in', ['scheduled', 'publishing', 'partially_published', 'failed'])
      .orderBy('scheduled_for', 'asc')
      .limit(6)
      .execute(),
    db.selectFrom('conversations')
      .select(['id', 'human_attention_reason', 'human_attention_at', 'last_message_preview'])
      .where('human_attention', '=', true)
      .orderBy('human_attention_at', 'desc')
      .limit(6)
      .execute(),
    db.selectFrom('provider_readiness').select(['ok', 'checked_at']).where('check_key', '=', 'insights').executeTakeFirst(),
  ]);

  // Every number below comes from the ONE shared analytics service, so the
  // Dashboard, /api/dashboard and the Analytics workspace never disagree.
  const m = analytics.metrics;
  const total = (k: string) => m[k]?.total ?? 0;
  const inboundSeries = m.inbound_messages?.values ?? [];
  const aiSeries = m.ai_replies?.values ?? [];
  const PROVIDER_LABELS: Record<string, { ar: string; en: string }> = {
    facebook_page_engagements: { ar: 'تفاعل فيسبوك', en: 'Facebook engagement' },
    facebook_page_views: { ar: 'مشاهدات صفحة فيسبوك', en: 'Facebook Page views' },
    instagram_reach: { ar: 'وصول إنستغرام', en: 'Instagram reach' },
    instagram_views: { ar: 'مشاهدات إنستغرام', en: 'Instagram views' },
    instagram_interactions: { ar: 'تفاعل إنستغرام', en: 'Instagram interactions' },
  };
  // Reach is unique (non-additive): its period total is intentionally null, so
  // it is shown as "daily only" instead of an overstated sum.
  const providerMetrics = analytics.provider.filter((p) => p.available).map((p) => ({
    key: p.metric,
    ar: PROVIDER_LABELS[p.metric]?.ar ?? p.metric,
    en: PROVIDER_LABELS[p.metric]?.en ?? p.metric,
    total: p.total,
  }));
  const problems = counts.deliveryProblems + counts.deadJobs + counts.failedPubs;

  return (
    <div>
      <AutoRefresh intervalMs={30000} />
      <PageHeader icon={LayoutDashboard} title={t('dashboard_title')} subtitle={t('dashboard_subtitle')} />

      {(counts.attention > 0 || problems > 0) && (
        <section className="mb-4 grid gap-3 sm:grid-cols-2">
          {counts.attention > 0 && (
            <Link href="/inbox?filter=attention" className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 transition hover:bg-warning/15">
              <HandHelping size={20} className="shrink-0 text-warning" />
              <div>
                <p className="text-sm font-semibold text-fg">
                  {ar ? `${counts.attention} محادثة تحتاج متابعة الفريق` : `${counts.attention} conversation(s) need the team`}
                </p>
                <p className="text-xs text-muted">{ar ? 'طلبات، شكاوى أو أسعار ناقصة' : 'Orders, complaints or missing prices'}</p>
              </div>
            </Link>
          )}
          {problems > 0 && (
            <Link href="/settings?tab=activity" className="flex items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 transition hover:bg-danger/15">
              <AlertTriangle size={20} className="shrink-0 text-danger" />
              <div>
                <p className="text-sm font-semibold text-fg">
                  {ar ? `${problems} مشكلة تشغيلية` : `${problems} operational issue(s)`}
                </p>
                <p className="text-xs text-muted">
                  {ar
                    ? `${counts.deliveryProblems} إرسال متعثّر · ${counts.failedPubs} نشر فاشل · ${counts.deadJobs} مهمة متوقفة`
                    : `${counts.deliveryProblems} delivery · ${counts.failedPubs} publish · ${counts.deadJobs} dead jobs`}
                </p>
              </div>
            </Link>
          )}
        </section>
      )}

      <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={MessageSquare} label={ar ? 'رسائل واردة (٧ أيام)' : 'Inbound (7d)'} value={total('inbound_messages').toLocaleString()} hint={deltaHint(m.inbound_messages?.changePct, ar)} />
        <StatCard icon={Bot} label={ar ? 'ردود الذكاء (٧ أيام)' : 'AI replies (7d)'} value={total('ai_replies').toLocaleString()} hint={deltaHint(m.ai_replies?.changePct, ar)} />
        <StatCard icon={HandHelping} label={ar ? 'تحويلات واتساب (٧ أيام)' : 'WhatsApp handoffs (7d)'} value={total('order_handoffs').toLocaleString()} hint={ar ? 'نية شراء — ليست طلبات مؤكدة' : 'Buying intent — not confirmed orders'} />
        <StatCard icon={Clapperboard} label={ar ? 'منشورات ناجحة (٧ أيام)' : 'Published (7d)'} value={total('content_published').toLocaleString()} hint={deltaHint(m.content_published?.changePct, ar)} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <SectionTitle icon={TrendingUp} title={ar ? 'آخر ٧ أيام' : 'Last 7 days'} action={<Link href="/analytics" className="text-xs font-medium text-accent hover:underline">{ar ? 'التحليلات الكاملة ←' : 'Full analytics →'}</Link>} />
            {inboundSeries.length === 0 ? (
              <p className="text-sm text-muted">
                {ar
                  ? 'تظهر الاتجاهات بعد أول تشغيل لمهمة التحليلات في الخلفية.'
                  : 'Trends appear after the background analytics job runs for the first time.'}
              </p>
            ) : (
              <div className="space-y-3">
                <TrendRow label={ar ? 'رسائل واردة' : 'Inbound messages'} series={inboundSeries} tone="accent" />
                <TrendRow label={ar ? 'ردود الذكاء' : 'AI replies'} series={aiSeries} tone="success" />
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle icon={Clapperboard} title={ar ? 'خط المحتوى' : 'Content pipeline'} />
            {upcoming.length === 0 ? (
              <EmptyState icon={Clapperboard} title={ar ? 'لا يوجد محتوى مجدول' : 'Nothing scheduled'} hint={ar ? 'أنشئ منشوراً من استوديو المحتوى.' : 'Create a post in Content Studio.'} />
            ) : (
              <ul className="divide-y divide-line">
                {upcoming.map((c) => (
                  <li key={c.id}>
                    <Link href={`/content-studio/${c.id}`} className="flex items-center justify-between gap-3 py-2.5 transition hover:bg-surface2/40">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg" dir="auto">{c.title || (ar ? 'بدون عنوان' : 'Untitled')}</p>
                        <p className="text-xs text-muted">
                          {(c.platforms ?? []).join(' + ')} · {c.content_type === 'story' ? (ar ? 'ستوري' : 'Story') : (ar ? 'منشور' : 'Post')}
                          {c.scheduled_for ? ` · ${timeAgo(c.scheduled_for, locale)}` : ''}
                        </p>
                      </div>
                      <Badge tone={c.status === 'failed' ? 'bad' : c.status === 'partially_published' ? 'warn' : 'info'}>
                        {c.status}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionTitle icon={HandHelping} title={ar ? 'يحتاج متابعة' : 'Needs follow-up'} />
            {recentAttention.length === 0 ? (
              <p className="text-sm text-muted">{t('all_clear_hint')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {recentAttention.map((c) => (
                  <li key={c.id}>
                    <Link href={`/inbox/${c.id}`} className="flex items-center justify-between gap-3 py-2.5 transition hover:bg-surface2/40">
                      <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-fg" dir="auto">{c.last_message_preview || '—'}</p>
                      <span className="shrink-0 text-xs text-muted">{c.human_attention_reason ?? ''}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <SystemStatus statuses={statuses} locale={locale} />
          <Card>
            <SectionTitle icon={Package} title={ar ? 'الأكثر طلباً (٣٠ يوم)' : 'Most requested (30d)'} />
            {topProducts.length === 0 ? (
              <p className="text-sm text-muted">{t('no_data_yet')}</p>
            ) : (
              <ul className="space-y-1.5">
                {topProducts.map((p) => (
                  <li key={p.product_id}>
                    <Link href={`/catalog/${p.product_id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition hover:bg-surface2/60">
                      <span className="min-w-0 truncate text-sm text-fg" dir="auto">{p.name ?? '—'}</span>
                      <span className="shrink-0 text-xs font-semibold text-accent">{p.hits}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <SectionTitle icon={Activity} title={ar ? 'رؤى فيسبوك وإنستغرام' : 'Facebook & Instagram insights'} />
            {providerMetrics.length > 0 ? (
              <ul className="space-y-2">
                {providerMetrics.map((metric) => (
                  <li key={metric.key} className="flex items-center justify-between gap-3 rounded-lg bg-surface2/60 px-3 py-2 text-sm">
                    <span className="text-muted">{ar ? metric.ar : metric.en}</span>
                    {metric.total != null
                      ? <b className="tabular-nums text-fg">{metric.total.toLocaleString()}</b>
                      : <span className="text-xs text-faint">{ar ? 'يومي فقط' : 'daily only'}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                {insightsReadiness?.ok
                  ? (ar ? 'الاتصال جاهز. تظهر الأرقام هنا بعد أول مزامنة تتضمن بيانات من Meta.' : 'Connected. Numbers appear after the first sync that contains Meta data.')
                  : (ar ? 'فعّل صلاحية read_insights من صفحة القنوات لإظهار الوصول والمشاهدات والتفاعل الحقيقي.' : 'Enable read_insights in Channels to show real reach, views and engagement.')}
              </p>
            )}
            <Link href="/settings?tab=channels" className="mt-2 inline-block text-sm font-medium text-accent hover:underline">{ar ? 'إعداد الرؤى والقنوات ←' : 'Set up insights and channels →'}</Link>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** "▲ 12% عن الفترة السابقة" — null pct means no prior baseline. */
function deltaHint(pct: number | null | undefined, ar: boolean): string | undefined {
  if (pct == null) return ar ? 'جديد — لا مقارنة سابقة' : 'New — no prior period';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';
  const suffix = ar ? 'عن الفترة السابقة' : 'vs previous period';
  return `${arrow} ${Math.abs(pct).toFixed(0)}% ${suffix}`;
}

function TrendRow({ label, series, tone }: { label: string; series: number[]; tone: 'accent' | 'success' }) {
  const max = Math.max(1, ...series);
  const color = tone === 'accent' ? 'bg-accent' : 'bg-success';
  const sum = series.reduce((a, b) => a + b, 0);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-semibold tabular-nums text-fg">{sum.toLocaleString()}</span>
      </div>
      <div className="flex h-10 items-end gap-1" dir="ltr" role="img" aria-label={`${label}: ${sum}`}>
        {series.map((v, i) => (
          <div key={i} className={`${color} min-w-1 flex-1 rounded-t-sm opacity-80`} style={{ height: `${Math.max(6, (v / max) * 100)}%` }} title={String(v)} />
        ))}
      </div>
    </div>
  );
}
