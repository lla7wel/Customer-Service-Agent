import Link from 'next/link';
import {
  Settings, Database, Bot, Facebook, Languages, Palette, ShieldCheck,
  CircleCheck, CircleAlert, Link2, Activity, Store, Users, Radio,
} from 'lucide-react';
import { PageHeader, Card, Badge, SectionTitle } from '@/components/ui';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import ThemeToggle from '@/components/ThemeToggle';
import BusinessFactsEditor from '@/components/settings/BusinessFactsEditor';
import AdminsManager from '@/components/settings/AdminsManager';
import ChannelReadiness from '@/components/settings/ChannelReadiness';
import { getT } from '@/lib/i18n/server';
import { getTheme } from '@/lib/theme-server';
import { allIntegrationStatuses, metaStatus, webhookUrls, type IntegrationStatus } from '@integrations/status';
import { getDb } from '@/lib/db';
import { timeAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';

const TABS = [
  { id: 'general', ar: 'عام', en: 'General', icon: Settings },
  { id: 'channels', ar: 'القنوات', en: 'Channels', icon: Radio },
  { id: 'facts', ar: 'حقائق المتجر', en: 'Business Facts', icon: Store },
  { id: 'admins', ar: 'المشرفون', en: 'Admins', icon: Users },
  { id: 'activity', ar: 'النشاط والأخطاء', en: 'Activity', icon: Activity },
];

export default async function SettingsPage(props: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = 'general' } = await props.searchParams;
  const { t, locale } = await getT();
  const ar = locale === 'ar';
  const theme = await getTheme();
  const statuses = allIntegrationStatuses();
  const hooks = webhookUrls();
  const metaConfigured = metaStatus().configured;

  return (
    <div>
      <PageHeader
        icon={Settings}
        title={t('nav_settings')}
        subtitle={ar ? 'القنوات، الحقائق، المشرفون، النشاط' : 'Channels, facts, admins, activity'}
      />

      <div className="mb-4 flex flex-wrap gap-1.5 rounded-xl border border-line/70 bg-surface/70 p-1.5 shadow-card backdrop-blur-md">
        {TABS.map((tb) => (
          <Link
            key={tb.id}
            href={`/settings${tb.id === 'general' ? '' : `?tab=${tb.id}`}`}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3.5 text-sm font-medium transition ${
              tab === tb.id ? 'border-accent/40 bg-accent/12 text-accent shadow-glow' : 'border-transparent text-muted hover:bg-surface2 hover:text-fg'
            }`}
          >
            <tb.icon size={15} />
            {ar ? tb.ar : tb.en}
          </Link>
        ))}
      </div>

      {tab === 'general' && <GeneralTab ar={ar} theme={theme} locale={locale} statuses={statuses} hooks={hooks} metaConfigured={metaConfigured} />}
      {tab === 'channels' && <Card><SectionTitle icon={Radio} title={ar ? 'جاهزية القنوات' : 'Channel readiness'} /><ChannelReadiness /></Card>}
      {tab === 'facts' && <Card><SectionTitle icon={Store} title={ar ? 'حقائق المتجر' : 'Business facts'} /><BusinessFactsEditor /></Card>}
      {tab === 'admins' && <Card><SectionTitle icon={Users} title={ar ? 'حسابات المشرفين' : 'Admin accounts'} /><AdminsManager /></Card>}
      {tab === 'activity' && <ActivityTab ar={ar} locale={locale} />}
    </div>
  );
}

function GeneralTab({ ar, theme, locale, statuses, hooks, metaConfigured }: any) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {statuses.map((s: IntegrationStatus) => (
          <Card key={s.key} className={s.configured ? '' : 'border-warning/30'}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${s.configured ? 'bg-success/12 text-success' : 'bg-warning/12 text-warning'}`}>
                  {s.key === 'gemini' ? <Bot size={20} /> : s.key === 'meta' ? <Facebook size={20} /> : <Database size={20} />}
                </span>
                <div>
                  <p className="text-sm font-semibold text-fg">{s.label}</p>
                  <p className="text-xs text-muted">{s.hint}</p>
                </div>
              </div>
              {s.configured
                ? <Badge tone="good"><CircleCheck size={12} /> {ar ? 'مربوط' : 'Connected'}</Badge>
                : <Badge tone="warn"><CircleAlert size={12} /> {ar ? 'يحتاج إعداد' : 'Setup'}</Badge>}
            </div>
            {!s.configured && s.missing.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1">
                {s.missing.map((v: string) => (
                  <li key={v} className="rounded-sm border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-warning">{v}</li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle icon={Link2} title={ar ? 'ويبهوك ماسنجر وإنستغرام' : 'Messenger & Instagram webhook'} />
          <Badge tone={metaConfigured ? 'good' : 'neutral'}>{metaConfigured ? (ar ? 'مهيّأ' : 'Configured') : (ar ? 'مُجهّز فقط' : 'Prepared only')}</Badge>
        </div>
        <p className="mb-3 text-xs text-muted">
          {ar
            ? 'استخدم هذا الرابط كـ Callback URL في إعداد Meta App (كائنا Page وInstagram). رمز التحقق هو META_VERIFY_TOKEN (لا يُعرض هنا).'
            : 'Use this URL as the Callback URL in the Meta App (both Page and Instagram objects). The verify token is META_VERIFY_TOKEN (not shown).'}
        </p>
        {!hooks.baseUrlSet && (
          <p className="mb-2 text-xs text-warning">{ar ? 'حدّد APP_BASE_URL لإظهار الرابط الكامل.' : 'Set APP_BASE_URL to show the full URL.'}</p>
        )}
        <div className="rounded-lg border border-line bg-surface2 px-3 py-2">
          <p className="mt-0.5 break-all font-mono text-[11px] text-fg" dir="ltr">{hooks.url}</p>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <SectionTitle icon={Palette} title={ar ? 'المظهر' : 'Theme'} />
          <ThemeToggle initial={theme} />
        </Card>
        <Card>
          <SectionTitle icon={Languages} title={ar ? 'اللغة' : 'Language'} />
          <LanguageSwitcher locale={locale} />
        </Card>
      </div>

      <Card>
        <SectionTitle icon={ShieldCheck} title={ar ? 'الأمان' : 'Security'} />
        <ul className="space-y-1.5 text-sm text-muted">
          <li>• {ar ? 'الجلسات مسجّلة في قاعدة البيانات وقابلة للإلغاء فوراً.' : 'Sessions are database-backed and instantly revocable.'}</li>
          <li>• {ar ? 'تسجيل الدخول محمي من التخمين (حد للمحاولات الفاشلة).' : 'Login is rate-limited against brute force.'}</li>
          <li>• {ar ? 'بدون SESSION_SECRET يرفض التطبيق العمل (fail-closed).' : 'Without SESSION_SECRET the app refuses to serve (fail-closed).'}</li>
          <li>• {ar ? 'كل إجراءات المشرفين مسجّلة في سجل تدقيق فردي.' : 'Every admin action lands in an individual audit log.'}</li>
        </ul>
      </Card>
    </div>
  );
}

async function ActivityTab({ ar, locale }: { ar: boolean; locale: string }) {
  const db = getDb();
  if (!db) return <Card><p className="text-sm text-muted">DATABASE_URL…</p></Card>;
  const [audit, deadJobs, failedOutbox, integrationErrors] = await Promise.all([
    db.selectFrom('admin_audit_log')
      .select(['id', 'admin_username', 'action', 'entity_type', 'created_at'])
      .orderBy('created_at', 'desc').limit(30).execute(),
    db.selectFrom('jobs')
      .select(['id', 'job_type', 'last_error', 'finished_at'])
      .where('status', '=', 'dead').orderBy('finished_at', 'desc').limit(15).execute(),
    db.selectFrom('outbox_messages')
      .select(['id', 'kind', 'status', 'last_error', 'created_at'])
      .where('status', 'in', ['failed', 'uncertain', 'dead'])
      .orderBy('created_at', 'desc').limit(15).execute(),
    db.selectFrom('integration_logs')
      .select(['id', 'integration', 'error', 'created_at'])
      .where('ok', '=', false).orderBy('created_at', 'desc').limit(15).execute(),
  ]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <SectionTitle icon={Activity} title={ar ? 'سجل تدقيق المشرفين' : 'Admin audit log'} />
        {audit.length === 0 ? <p className="text-sm text-muted">—</p> : (
          <ul className="divide-y divide-line text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate text-fg">
                  <span className="font-semibold">{a.admin_username ?? 'system'}</span>
                  <span className="text-muted"> · {a.action}</span>
                </span>
                <span className="shrink-0 text-xs text-faint">{timeAgo(a.created_at, locale as any)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="space-y-4">
        <Card>
          <SectionTitle icon={CircleAlert} title={ar ? 'إرسالات متعثرة' : 'Delivery problems'} />
          {failedOutbox.length === 0 ? <p className="text-sm text-success">{ar ? 'لا شيء ✓' : 'None ✓'}</p> : (
            <ul className="space-y-1.5 text-xs">
              {failedOutbox.map((o) => (
                <li key={o.id} className="rounded-lg border border-danger/30 bg-danger/5 px-2.5 py-1.5">
                  <span className="font-semibold text-danger">{o.status}</span>
                  <span className="text-muted"> · {o.kind} · {o.last_error ?? ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle icon={CircleAlert} title={ar ? 'مهام متوقفة (dead)' : 'Dead jobs'} />
          {deadJobs.length === 0 ? <p className="text-sm text-success">{ar ? 'لا شيء ✓' : 'None ✓'}</p> : (
            <ul className="space-y-1.5 text-xs">
              {deadJobs.map((j) => (
                <li key={j.id} className="rounded-lg border border-danger/30 bg-danger/5 px-2.5 py-1.5">
                  <span className="font-semibold text-danger">{j.job_type}</span>
                  <span className="text-muted"> · {j.last_error ?? ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle icon={CircleAlert} title={ar ? 'أخطاء التكاملات' : 'Integration errors'} />
          {integrationErrors.length === 0 ? <p className="text-sm text-success">{ar ? 'لا شيء ✓' : 'None ✓'}</p> : (
            <ul className="space-y-1.5 text-xs">
              {integrationErrors.map((e) => (
                <li key={e.id} className="rounded-lg border border-warning/30 bg-warning/5 px-2.5 py-1.5">
                  <span className="font-semibold text-warning">{e.integration}</span>
                  <span className="text-muted"> · {e.error ?? ''} · {timeAgo(e.created_at, locale as any)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
