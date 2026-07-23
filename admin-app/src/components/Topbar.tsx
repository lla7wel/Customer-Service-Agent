import { ShieldCheck, Zap } from 'lucide-react';
import LogoutButton from './LogoutButton';
import LanguageSwitcher from './LanguageSwitcher';
import ThemeToggle from './ThemeToggle';
import SearchBar from './SearchBar';
import BrandMark from './BrandMark';
import type { Locale } from '@/lib/i18n/config';
import type { Theme } from '@/lib/theme';
import { translate } from '@/lib/i18n/dictionaries';
import type { IntegrationStatus } from '@integrations/status';

/** Top bar: global search, theme + language, integration health, profile. */
export default function Topbar({
  locale,
  theme,
  statuses,
  userEmail,
}: {
  locale: Locale;
  theme: Theme;
  statuses: IntegrationStatus[];
  userEmail?: string | null;
}) {
  const t = (k: string) => translate(locale, k);
  const connectedCount = statuses.filter((s) => s.configured).length;
  return (
    <header className="safe-t safe-x sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur-xl sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="shrink-0 md:hidden"><BrandMark size="sm" /></div>
        <div className="hidden w-full md:block"><SearchBar placeholder={t('search_ph')} ar={locale === 'ar'} /></div>
      </div>

      <div className="hidden items-center gap-2 md:flex">
        {/* integration health */}
        <div className="hidden items-center gap-2 rounded-xl border border-line bg-surface2/60 px-2.5 py-1.5 lg:flex">
          <span className="inline-flex items-center gap-1 rounded-lg bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent">
            <Zap size={12} />
            {connectedCount}/{statuses.length}
          </span>
          {statuses.map((s) => (
            <span
              key={s.key}
              title={`${s.label}: ${s.configured ? t('connected') : t('not_connected')}${
                s.missing.length ? ` — ${s.missing.join(', ')}` : ''
              }`}
              className="flex items-center gap-1 text-[11px] text-muted"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${s.configured ? 'bg-success' : 'bg-faint'}`} />
              <span className="hidden xl:inline">{s.label}</span>
            </span>
          ))}
        </div>

        <ThemeToggle initial={theme} />
        <LanguageSwitcher locale={locale} />

        {/* profile */}
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface2/60 py-1 pe-1 ps-2">
          <ShieldCheck size={15} className="text-accent" />
          <span className="hidden text-xs text-muted sm:inline">
            {userEmail || (locale === 'ar' ? 'مشرف' : 'Admin')}
          </span>
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-white">
            {(userEmail?.[0] || 'A').toUpperCase()}
          </span>
          <LogoutButton label={locale === 'ar' ? 'تسجيل الخروج' : 'Sign out'} />
        </div>
      </div>
    </header>
  );
}
