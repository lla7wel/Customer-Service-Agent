import {
  Settings, Database, Bot, Facebook, Cloud, Languages, Palette, ShieldCheck,
  CircleCheck, CircleAlert, FileCog, Rocket, Link2, XCircle,
} from 'lucide-react';
import { PageHeader, Card, Badge, SectionTitle } from '@/components/ui';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import ThemeToggle from '@/components/ThemeToggle';
import { getT } from '@/lib/i18n/server';
import { getTheme } from '@/lib/theme-server';
import { allIntegrationStatuses, metaStatus, webhookUrls, type IntegrationStatus } from '@integrations/status';
import { getReadiness, type ReadinessItem } from '@/lib/readiness';

export const dynamic = 'force-dynamic';

const META: Record<string, { icon: any; action: { en: string; ar: string } }> = {
  supabase: { icon: Database, action: { en: 'Run database/schema.sql, then add the API keys.', ar: 'شغّل database/schema.sql ثم أضف المفاتيح.' } },
  gemini: { icon: Bot, action: { en: 'Add GEMINI_API_KEY from Google AI Studio.', ar: 'أضف GEMINI_API_KEY من Google AI Studio.' } },
  meta: { icon: Facebook, action: { en: 'Add the META_* page token + webhook secrets.', ar: 'أضف رمز الصفحة META_* وأسرار الويبهوك.' } },
  cloudflare: { icon: Cloud, action: { en: 'Optional — for off-app webhooks/cron.', ar: 'اختياري — لويبهوك/كرون خارج التطبيق.' } },
};

export default async function SettingsPage() {
  const { t, locale } = await getT();
  const ar = locale === 'ar';
  const theme = await getTheme();
  const statuses = allIntegrationStatuses();
  const connectedCount = statuses.filter((s) => s.configured).length;
  const readiness = await getReadiness();
  const hooks = webhookUrls();
  const metaConfigured = metaStatus().configured;

  return (
    <div>
      <PageHeader
        icon={Settings}
        title={t('nav_settings')}
        subtitle={ar ? 'الربط، الجاهزية، المظهر، اللغة' : 'Integrations, readiness, theme, language'}
        actions={<Badge tone={connectedCount === statuses.length ? 'good' : 'warn'}>{connectedCount}/{statuses.length} {ar ? 'مربوط' : 'connected'}</Badge>}
      />

      <section className="command-surface mb-5 grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="relative flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
            <ShieldCheck size={19} />
          </span>
          <div>
            <p className="text-sm font-semibold text-fg">{ar ? 'مركز صحة الإنتاج' : 'Production health center'}</p>
            <p className="text-xs text-muted">{ar ? 'الجاهزية، التكاملات، والويبهوك في مكان واحد.' : 'Readiness, integrations, and webhook status in one place.'}</p>
          </div>
        </div>
        <div className="relative grid grid-cols-2 gap-2 text-xs sm:w-72">
          <HealthStat label={ar ? 'الربط' : 'Integrations'} value={`${connectedCount}/${statuses.length}`} tone={connectedCount === statuses.length ? 'good' : 'warn'} />
          <HealthStat label={ar ? 'الجاهزية' : 'Readiness'} value={`${readiness.passed}/${readiness.total}`} tone={readiness.ready ? 'good' : 'warn'} />
        </div>
      </section>

      {/* Production readiness */}
      <Card className="mb-5">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle icon={Rocket} title={ar ? 'جاهزية النشر' : 'Production readiness'} />
          <Badge tone={readiness.ready ? 'good' : 'warn'}>
            {readiness.ready ? (ar ? 'جاهز للنشر' : 'Ready to publish') : (ar ? 'غير جاهز بعد' : 'Not ready yet')}
            {` · ${readiness.passed}/${readiness.total}`}
          </Badge>
        </div>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {readiness.items.map((it) => (
            <ReadinessRow key={it.key} it={it} ar={ar} />
          ))}
        </ul>
      </Card>

      {/* integrations */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        {statuses.map((s) => (
          <IntegrationCard key={s.key} s={s} ar={ar} />
        ))}
      </div>

      {/* Facebook / Messenger webhooks */}
      <Card className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle icon={Link2} title={ar ? 'ويبهوك فيسبوك/ماسنجر' : 'Facebook / Messenger webhooks'} />
          <Badge tone={metaConfigured ? 'good' : 'neutral'}>{metaConfigured ? (ar ? 'مهيّأ' : 'Configured') : (ar ? 'مُجهّز فقط' : 'Prepared only')}</Badge>
        </div>
        <p className="mb-3 text-xs text-muted">
          {ar
            ? 'استخدم هذا الرابط كـ Callback URL في إعداد Meta App. رمز التحقق هو متغيّر البيئة META_VERIFY_TOKEN (لا يُعرض هنا).'
            : 'Use this URL as the Callback URL in your Meta App setup. The verify token is the META_VERIFY_TOKEN env var (not shown here).'}
        </p>
        {!hooks.baseUrlSet && (
          <p className="mb-2 text-xs text-warning">{ar ? 'حدّد APP_BASE_URL لإظهار الرابط الكامل.' : 'Set APP_BASE_URL to show the full URL.'}</p>
        )}
        <div className="space-y-2">
          <WebhookRow label={ar ? 'ويبهوك موحّد' : 'Unified webhook'} url={hooks.url} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <SectionTitle icon={Palette} title={t('theme')} />
          <p className="mb-3 text-xs text-muted">{ar ? 'بدّل بين الوضع الداكن والفاتح.' : 'Switch between dark and light.'}</p>
          <ThemeToggle initial={theme} />
        </Card>

        <Card>
          <SectionTitle icon={Languages} title={t('language')} />
          <p className="mb-3 text-xs text-muted">{ar ? 'الواجهة تدعم العربية (RTL) والإنجليزية.' : 'UI supports Arabic (RTL) and English.'}</p>
          <LanguageSwitcher locale={locale} />
        </Card>

        <Card>
          <SectionTitle icon={ShieldCheck} title={ar ? 'الحساب والصلاحيات' : 'Account & roles'} />
          <p className="text-sm text-muted">
            {ar ? 'دور واحد (admin) بكامل الصلاحيات. القاعدة مهيّأة لإضافة أدوار لاحقاً.' : 'Single admin role with full access. Schema is ready for more roles later.'}
          </p>
        </Card>
      </div>

      <Card className="mt-5">
        <SectionTitle icon={FileCog} title={ar ? 'مصدر السكرابر (للقراءة فقط)' : 'Scraper source (read-only)'} />
        <p className="text-sm text-muted">
          {ar ? 'السكرابر مشروع منفصل ولا يُعدَّل أبداً. يُقرأ فقط للاستيراد عبر scripts/.' : 'The scraper is a separate project, never modified. Read-only for import via scripts/.'}
        </p>
        <p className="mt-1 font-mono text-[11px] text-faint">../english-home-tr-scraper/data/output</p>
      </Card>
    </div>
  );
}

function ReadinessRow({ it, ar }: { it: ReadinessItem; ar: boolean }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface2 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        {it.ok ? <CircleCheck size={15} className="shrink-0 text-success" /> : it.critical ? <XCircle size={15} className="shrink-0 text-danger" /> : <CircleAlert size={15} className="shrink-0 text-warning" />}
        <span className="truncate text-sm text-fg">{it.label}{!it.critical && <span className="ms-1 text-[10px] text-faint">{ar ? '(اختياري)' : '(optional)'}</span>}</span>
      </div>
      <span className="shrink-0 truncate text-[11px] text-faint" title={it.detail} dir="auto">{it.detail}</span>
    </li>
  );
}

function HealthStat({ label, value, tone }: { label: string; value: string; tone: 'good' | 'warn' }) {
  return (
    <div className="rounded-lg border border-line bg-surface/80 px-2.5 py-2">
      <p className="truncate text-[10px] text-faint">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${tone === 'good' ? 'text-success' : 'text-warning'}`}>{value}</p>
    </div>
  );
}

function WebhookRow({ label, url }: { label: string; url: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface2 px-3 py-2">
      <p className="text-[11px] font-medium text-muted">{label}</p>
      <p className="mt-0.5 break-all font-mono text-[11px] text-fg">{url}</p>
    </div>
  );
}

function IntegrationCard({ s, ar }: { s: IntegrationStatus; ar: boolean }) {
  const m = META[s.key];
  const Icon = m?.icon ?? Database;
  return (
    <Card className={s.configured ? '' : 'border-warning/30'}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${s.configured ? 'bg-success/12 text-success' : 'bg-warning/12 text-warning'}`}>
            <Icon size={20} />
          </span>
          <div>
            <p className="text-sm font-semibold text-fg">{s.label}</p>
            <p className="text-xs text-muted">{s.hint}</p>
          </div>
        </div>
        {s.configured ? (
          <Badge tone="good"><CircleCheck size={12} /> {ar ? 'مربوط' : 'Connected'}</Badge>
        ) : (
          <Badge tone="warn"><CircleAlert size={12} /> {ar ? 'يحتاج إعداد' : 'Setup'}</Badge>
        )}
      </div>

      {!s.configured && (
        <div className="mt-3 rounded-lg border border-line bg-surface2 p-3">
          <p className="text-xs font-medium text-fg">{ar ? 'الإجراء المطلوب' : 'Action required'}</p>
          <p className="mt-0.5 text-xs text-muted">{ar ? m?.action.ar : m?.action.en}</p>
          {s.missing.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1">
              {s.missing.map((v) => (
                <li key={v} className="rounded-sm border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-warning">{v}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
