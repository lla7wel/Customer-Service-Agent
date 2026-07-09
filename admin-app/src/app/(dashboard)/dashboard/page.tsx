import Link from 'next/link';
import {
  LayoutDashboard, Inbox, AlertTriangle, Package,
  Megaphone, Activity, ArrowUpRight, CircleCheck, Bot, CalendarClock, Database,
  Tags, Images, ImageOff, Sparkles,
} from 'lucide-react';
import { PageHeader, Card, StatCard, SectionTitle, Badge, EmptyState, Meter } from '@/components/ui';
import SystemStatus from '@/components/dashboard/SystemStatus';
import Diagnostics from '@/components/catalog/Diagnostics';
import NotConnected from '@/components/NotConnected';
import { getT } from '@/lib/i18n/server';
import { allIntegrationStatuses, databaseStatus, geminiStatus } from '@integrations/status';
import { fetchRows, countRows } from '@/lib/data';
import { getCatalogStats } from '@/lib/catalog';
import { conversationTone, campaignTone } from '@/lib/status-tone';
import { activityLabel, activitySummary, humanize, timeAgo, formatDate } from '@/lib/format';
import type { Conversation, Campaign, ActivityLog, AiEvent } from '@integrations/db/rows';

export const dynamic = 'force-dynamic';

const NEEDS_ACTION = ['needs_human', 'waiting_for_order_confirmation', 'issue_refund_exchange', 'human_active'];

export default async function DashboardPage() {
  const { t, locale } = getT();
  const ar = locale === 'ar';
  const statuses = allIntegrationStatuses();
  const sConnected = databaseStatus().configured;

  const [
    needsAction, campaigns, activity, aiErrors,
    convCount, actionCount, productCount, aiErrCount, aiOkCount, importRun,
  ] = await Promise.all([
    fetchRows<Conversation>('conversations', (q) => q.where('status', 'in', NEEDS_ACTION).orderBy('last_message_at', (ob: any) => ob.desc().nullsLast()).limit(6)),
    fetchRows<Campaign>('campaigns', (q) => q.where('status', 'in', ['scheduled', 'publishing', 'published', 'draft']).orderBy('starts_at', (ob: any) => ob.asc().nullsLast()).limit(5)),
    fetchRows<ActivityLog>('activity_logs', (q) => q.orderBy('created_at', 'desc').limit(8)),
    fetchRows<AiEvent>('ai_events', (q) => q.where('success', '=', false).orderBy('created_at', 'desc').limit(4)),
    countRows('conversations'),
    countRows('conversations', (q) => q.where('status', 'in', NEEDS_ACTION)),
    countRows('products'),
    countRows('ai_events', (q) => q.where('success', '=', false)),
    countRows('ai_events', (q) => q.where('success', '=', true)),
    fetchRows<any>('product_import_runs', (q) => q.orderBy('started_at', 'desc').limit(1)),
  ]);

  const catalog = await getCatalogStats();

  const n = (r: { connected: boolean; count: number | null }) => (!r.connected ? '—' : (r.count ?? 0).toString());
  const aiTotal = (aiOkCount.count ?? 0) + (aiErrCount.count ?? 0);
  const aiSuccessRate = aiTotal > 0 ? Math.round(((aiOkCount.count ?? 0) / aiTotal) * 100) : null;
  const run = importRun.rows[0];

  return (
    <div>
      <PageHeader icon={LayoutDashboard} title={t('dashboard_title')} subtitle={t('dashboard_subtitle')} />

      {!sConnected && (
        <div className="mb-6">
          <NotConnected status={databaseStatus()} />
        </div>
      )}

      <section className="command-surface mb-6 grid gap-5 p-5 lg:grid-cols-[1.35fr_0.65fr] lg:p-6">
        <div className="relative">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone={sConnected ? 'good' : 'warn'} dot>{sConnected ? (ar ? 'متصل' : 'Connected') : (ar ? 'غير متصل' : 'Not connected')}</Badge>
            <Badge tone={(aiErrCount.count ?? 0) > 0 ? 'warn' : 'accent'} dot>{aiSuccessRate != null ? `${aiSuccessRate}% ${ar ? 'نجاح AI' : 'AI success'}` : ar ? 'AI جاهز' : 'AI ready'}</Badge>
          </div>
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            {ar ? 'مركز قيادة المتجر والذكاء' : 'Store and AI command center'}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            {ar
              ? 'راجع المحادثات العاجلة، صحة الكتالوج، وحالة الحملات من شاشة واحدة.'
              : 'Watch urgent conversations, catalog health, and campaign readiness from one focused surface.'}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/inbox" className="btn-primary">
              <Inbox size={15} /> {ar ? 'فتح الوارد' : 'Open inbox'}
            </Link>
            <Link href="/catalog-review" className="btn-ghost">
              <Package size={15} /> {ar ? 'مراجعة الكتالوج' : 'Review catalog'}
            </Link>
          </div>
        </div>
        <CommandVisual ar={ar} aiSuccessRate={aiSuccessRate} actionCount={actionCount.count ?? 0} />
      </section>

      {/* KPI row */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard icon={AlertTriangle} tone="warn" label={t('needs_action')} value={n(actionCount)} href="/inbox?filter=action" />
        <StatCard icon={Inbox} tone="accent" label={ar ? 'المحادثات' : 'Conversations'} value={n(convCount)} href="/inbox" />
        <StatCard icon={Package} tone="default" label={ar ? 'المنتجات' : 'Products'} value={n(productCount)} href="/products" />
        <StatCard icon={Megaphone} tone="default" label={ar ? 'الحملات' : 'Campaigns'} value={catalog.connected ? campaigns.rows.length.toString() : '—'} href="/campaigns" />
        <StatCard icon={Bot} tone={(aiErrCount.count ?? 0) > 0 ? 'bad' : 'good'} label={ar ? 'أخطاء الذكاء' : 'AI errors'} value={n(aiErrCount)} href="/ai-control" />
      </div>

      {/* Catalog action priorities — loud when there's work to do. */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {catalog.needsReview > 0 && (
          <Link
            href="/price-review"
            className="tilt-card flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 transition hover:border-warning/50"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-warning/15 text-warning"><Tags size={18} /></span>
              <div>
                <p className="text-sm font-semibold text-fg">
                  {catalog.needsReview.toLocaleString()} {ar ? 'منتج بحاجة لمراجعة' : 'products need review'}
                </p>
                <p className="text-xs text-muted">{ar ? 'أضف الاسم العربي/الإنجليزي والسعر لتفعيلها.' : 'Add Arabic/English name + price to activate.'}</p>
              </div>
            </div>
            <span className="flex items-center gap-1 text-xs font-medium text-warning">{ar ? 'مراجعة' : 'Review'} <ArrowUpRight size={14} /></span>
          </Link>
        )}
        {catalog.activeMissingImages > 0 && (
          <Link
            href="/products?images=missing&status=active"
            className="tilt-card flex items-center justify-between gap-3 rounded-xl border border-info/30 bg-info/10 px-4 py-3 transition hover:border-info/50"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-info/15 text-info"><ImageOff size={18} /></span>
              <div>
                <p className="text-sm font-semibold text-fg">
                  {catalog.activeMissingImages.toLocaleString()} {ar ? 'منتج فعّال بدون صور' : 'active products missing images'}
                </p>
                <p className="text-xs text-muted">{ar ? 'راجع مطابقات الكتالوج أو ارفع صوراً من صفحة المنتجات.' : 'Review catalog matches or upload images from the products page.'}</p>
              </div>
            </div>
            <span className="flex items-center gap-1 text-xs font-medium text-info">{ar ? 'عرض' : 'View'} <ArrowUpRight size={14} /></span>
          </Link>
        )}
        {catalog.matchPossible > 0 && (
          <Link
            href="/catalog-match"
            className="tilt-card flex items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 transition hover:border-accent/50"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-accent"><Sparkles size={18} /></span>
              <div>
                <p className="text-sm font-semibold text-fg">
                  {catalog.matchPossible.toLocaleString()} {ar ? 'مطابقة صور محتملة للمراجعة' : 'possible image matches to review'}
                </p>
                <p className="text-xs text-muted">
                  {ar
                    ? `مقبولة ${catalog.matchApproved.toLocaleString()} · للمراجعة ${catalog.matchNeedsReview.toLocaleString()} · بلا تطابق ${catalog.matchNoSafe.toLocaleString()}`
                    : `${catalog.matchApproved.toLocaleString()} approved · ${catalog.matchNeedsReview.toLocaleString()} needs review · ${catalog.matchNoSafe.toLocaleString()} no safe match`}
                </p>
              </div>
            </div>
            <span className="flex items-center gap-1 text-xs font-medium text-accent">{ar ? 'مطابقة' : 'Match'} <ArrowUpRight size={14} /></span>
          </Link>
        )}
      </div>

      {/* Catalog diagnostics — products / images / uploaded / missing / review / active */}
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
          <Database size={13} /> {ar ? 'تشخيص الكتالوج' : 'Catalog diagnostics'}
        </div>
        <div className="rounded-xl border border-line/70 bg-surface/70 p-3 shadow-card backdrop-blur-md">
          <Diagnostics stats={catalog} ar={ar} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* LEFT 2/3 — action queue */}
        <div className="space-y-5 lg:col-span-2">
          {/* Conversations needing admin */}
          <Card>
            <SectionTitle
              icon={Inbox}
              title={t('conversations_need_admin')}
              count={needsAction.rows.length || undefined}
              action={<Link href="/inbox" className="text-xs text-accent hover:underline">{t('view_all')}</Link>}
            />
            {needsAction.rows.length === 0 ? (
              <AllClear ar={ar} />
            ) : (
              <ul className="divide-y divide-line">
                {needsAction.rows.map((c) => (
                  <li key={c.id}>
                    <Link href={`/inbox/${c.id}`} className="group flex items-center justify-between gap-3 py-2.5 transition hover:bg-surface2/50">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">
                          {c.context_summary?.slice(0, 48) || `#${c.id.slice(0, 8)}`}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {humanize(c.channel)} · {c.detected_intent || (ar ? 'بدون نية' : 'no intent')}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge tone={conversationTone(c.status)} dot>{humanize(c.status)}</Badge>
                        <span className="hidden text-xs text-faint sm:inline">{timeAgo(c.last_message_at, locale)}</span>
                        <ArrowUpRight size={15} className="text-faint opacity-0 transition group-hover:opacity-100" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Recent activity */}
          <Card>
            <SectionTitle icon={Activity} title={t('recent_activity')} action={<Link href="/logs" className="text-xs text-accent hover:underline">{t('view_all')}</Link>} />
            {activity.rows.length === 0 ? (
              <p className="py-4 text-center text-sm text-faint">{t('no_data_yet')}</p>
            ) : (
              <ul className="space-y-1">
                {activity.rows.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 py-1.5 text-sm">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${l.actor_type === 'human' ? 'bg-info' : l.actor_type === 'ai' ? 'bg-accent' : 'bg-faint'}`} />
                    <span className="font-medium text-fg">{activityLabel(l.action, locale)}</span>
                    {activitySummary(l.summary) && <span className="min-w-0 flex-1 truncate text-muted">{activitySummary(l.summary)}</span>}
                    <span className="shrink-0 text-xs text-faint">{timeAgo(l.created_at, locale)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* RIGHT 1/3 — status rail */}
        <div className="space-y-5">
          <SystemStatus statuses={statuses} locale={locale} />

          {/* AI status */}
          <Card>
            <SectionTitle icon={Bot} title={t('ai_status')} />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">{ar ? 'مزوّد الذكاء' : 'AI provider'}</span>
              <Badge tone={geminiStatus().configured ? 'good' : 'warn'} dot>Gemini</Badge>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">{ar ? 'نسبة نجاح الذكاء' : 'AI success rate'}</span>
                <span className="font-semibold text-fg">{aiSuccessRate != null ? `${aiSuccessRate}%` : '—'}</span>
              </div>
              <div className="mt-2"><Meter value={aiSuccessRate ?? 0} tone={aiSuccessRate != null && aiSuccessRate < 80 ? 'warn' : 'good'} /></div>
              <p className="mt-2 text-xs text-faint">{aiTotal} {ar ? 'عملية ذكاء مسجّلة' : 'AI events logged'}</p>
            </div>
            {aiErrors.rows.length > 0 && (
              <div className="mt-3 rounded-lg border border-danger/20 bg-danger/5 p-2.5">
                <p className="text-xs font-medium text-danger">{ar ? 'آخر الأخطاء' : 'Recent errors'}</p>
                <ul className="mt-1 space-y-0.5">
                  {aiErrors.rows.slice(0, 3).map((e) => (
                    <li key={e.id} className="truncate text-xs text-muted">{e.kind}: {e.error || 'error'}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {/* Campaign schedule */}
          <Card>
            <SectionTitle icon={CalendarClock} title={t('campaign_schedule')} action={<Link href="/campaigns" className="text-xs text-accent hover:underline">{t('view_all')}</Link>} />
            {campaigns.rows.length === 0 ? (
              <EmptyState icon={Megaphone} title={ar ? 'لا حملات' : 'No campaigns'} />
            ) : (
              <ul className="space-y-2">
                {campaigns.rows.map((c) => (
                  <li key={c.id}>
                    <Link href={`/campaigns/${c.id}`} className="flex items-center justify-between rounded-lg border border-line bg-surface2 px-3 py-2 transition hover:border-accent/40">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">{c.name}</p>
                        <p className="text-xs text-faint">{c.starts_at ? formatDate(c.starts_at, locale) : humanize(c.type)}</p>
                      </div>
                      <Badge tone={campaignTone(c.status)}>{humanize(c.status)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Product DB / import status */}
          <Card>
            <SectionTitle icon={Database} title={t('import_status')} />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">{ar ? 'منتجات في القاعدة' : 'Products in database'}</span>
              <span className="font-semibold text-fg">{n(productCount)}</span>
            </div>
            {run ? (
              <div className="mt-3 rounded-lg border border-line bg-surface2 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted">{ar ? 'آخر استيراد' : 'Last import'}</span>
                  <Badge tone={run.status === 'completed' ? 'good' : run.status === 'failed' ? 'bad' : 'warn'}>{humanize(run.status)}</Badge>
                </div>
                <p className="mt-1.5 text-faint">
                  +{run.created_count ?? 0} {ar ? 'جديد' : 'new'} · {run.updated_count ?? 0} {ar ? 'محدّث' : 'updated'} · {run.error_count ?? 0} {ar ? 'خطأ' : 'errors'}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-xs text-faint">
                {ar ? 'لم يتم استيراد بعد — شغّل scripts/import:products' : 'No import yet — run scripts/import:products'}
              </p>
            )}
          </Card>

          {/* Catalog images snapshot */}
          <Card>
            <SectionTitle
              icon={ImageOff}
              title={ar ? 'صور الكتالوج' : 'Catalog images'}
              action={<Link href="/catalog-match" className="text-xs text-accent hover:underline">{ar ? 'مطابقة' : 'Match'}</Link>}
            />
            <div className="grid grid-cols-2 gap-2 text-xs">
              <SyncStat label={ar ? 'صور مرفوعة' : 'Uploaded'} value={catalog.uploadedImages} />
              <SyncStat label={ar ? 'فعّال بدون صور' : 'Active missing'} value={catalog.activeMissingImages} tone={catalog.activeMissingImages > 0 ? 'warn' : undefined} />
              <SyncStat label={ar ? 'مطابقات ممكنة' : 'Possible matches'} value={catalog.matchPossible} />
              <SyncStat label={ar ? 'مطابقات معتمدة' : 'Approved'} value={catalog.matchApproved} />
            </div>
            <Link href="/catalog-match" className="btn-ghost mt-3 w-full justify-center">
              <Images size={14} /> {ar ? 'مراجعة المطابقات' : 'Review matches'}
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SyncStat({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <div className="rounded-lg border border-line bg-surface2 px-2.5 py-2">
      <p className="text-faint">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${tone === 'warn' ? 'text-warning' : 'text-fg'}`}>{value.toLocaleString()}</p>
    </div>
  );
}

function CommandVisual({
  ar,
  aiSuccessRate,
  actionCount,
}: {
  ar: boolean;
  aiSuccessRate: number | null;
  actionCount: number;
}) {
  return (
    <div className="command-visual relative hidden min-h-[220px] overflow-hidden rounded-xl border border-line/70 bg-surface2/60 p-5 lg:block">
      <div className="command-plane absolute inset-x-8 bottom-[-82px] h-56 rounded-xl border border-line/70 shadow-glow" />
      <div className="floating-tile absolute end-8 top-7 w-36 rounded-xl border border-accent/25 bg-surface/95 p-3 shadow-card">
        <p className="text-[10px] uppercase tracking-wide text-faint">{ar ? 'AI' : 'AI'}</p>
        <p className="mt-1 text-xl font-semibold text-fg">{aiSuccessRate != null ? `${aiSuccessRate}%` : '—'}</p>
        <div className="mt-2 h-1.5 rounded-full bg-surface2">
          <div className="h-full rounded-full bg-success" style={{ width: `${aiSuccessRate ?? 0}%` }} />
        </div>
      </div>
      <div className="floating-tile absolute start-8 top-20 w-40 rounded-xl border border-warning/25 bg-surface/95 p-3 shadow-card">
        <p className="text-[10px] uppercase tracking-wide text-faint">{ar ? 'الإجراءات' : 'Action queue'}</p>
        <p className="mt-1 text-2xl font-semibold text-warning">{actionCount.toLocaleString()}</p>
        <p className="mt-1 text-xs text-muted">{ar ? 'محادثات تحتاج متابعة' : 'conversations need follow-up'}</p>
      </div>
      <div className="floating-tile absolute bottom-6 end-16 w-32 rounded-xl border border-info/25 bg-surface/95 p-3 shadow-card">
        <p className="text-[10px] uppercase tracking-wide text-faint">{ar ? 'القنوات' : 'Channels'}</p>
        <div className="mt-2 flex gap-1.5">
          <span className="h-2 w-8 rounded-full bg-success" />
          <span className="h-2 w-8 rounded-full bg-accent" />
          <span className="h-2 w-8 rounded-full bg-info" />
        </div>
      </div>
    </div>
  );
}

function AllClear({ ar }: { ar: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-success/20 bg-success/5 px-3 py-4">
      <CircleCheck size={18} className="text-success" />
      <div>
        <p className="text-sm font-medium text-fg">{ar ? 'كل شيء تمام' : 'All clear'}</p>
        <p className="text-xs text-muted">{ar ? 'لا يوجد ما يحتاج إجراءً الآن.' : 'Nothing needs action right now.'}</p>
      </div>
    </div>
  );
}
