'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { NAV } from '@/lib/nav';
import { translate } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import type { IntegrationStatus } from '@integrations/status';

export default function Sidebar({
  locale,
  statuses,
}: {
  locale: Locale;
  statuses: IntegrationStatus[];
}) {
  const pathname = usePathname();
  const t = (k: string) => translate(locale, k);
  const allConnected = statuses.every((s) => s.configured);
  const connectedCount = statuses.filter((s) => s.configured).length;

  const CATALOG_REVIEW_PATHS = ['/catalog-review', '/catalog-match', '/image-review', '/price-review'];
  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/';
    if (href === '/catalog-review') return CATALOG_REVIEW_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-e border-line bg-surface md:flex">
      {/* brand */}
      <div className="flex h-18 items-center gap-3 border-b border-line px-5">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-sm font-bold tracking-wide text-white">
          EH
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight text-fg">{t('app_subtitle')}</p>
          <p className="text-[10px] uppercase tracking-[0.16em] text-muted">Operations Center</p>
        </div>
      </div>

      {/* nav */}
      <nav className="scroll-thin flex-1 overflow-y-auto px-3 py-5">
        {NAV.map((group) => (
          <div key={group.titleKey} className="mb-5">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
              {t(group.titleKey)}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                        active
                          ? 'border border-accent/15 bg-accent/8 font-semibold text-accent'
                          : 'border border-transparent text-muted hover:bg-surface2 hover:text-fg'
                      }`}
                    >
                      {active && <span className="absolute inset-y-2 inset-s-0 w-0.5 rounded-full bg-accent" />}
                      <Icon size={17} className={active ? 'text-accent' : 'text-faint group-hover:text-fg'} />
                      <span>{t(item.labelKey)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* footer: system pulse */}
      <div className="border-t border-line/70 p-3">
        <Link
          href="/settings"
          className="flex items-center justify-between rounded-xl border border-line bg-surface2/60 px-3 py-2.5 text-xs transition hover:border-accent/30"
        >
          <span className="relative flex items-center gap-2 text-muted">
            <Sparkles size={14} className={allConnected ? 'text-success' : 'text-warning'} />
            {locale === 'ar' ? 'الأنظمة' : 'Systems'}
          </span>
          <span className="relative flex items-center gap-1.5">
            {statuses.map((s) => (
              <span
                key={s.key}
                title={`${s.label}: ${s.configured ? 'connected' : 'not connected'}`}
                className={`h-1.5 w-1.5 rounded-full ${s.configured ? 'bg-success' : 'bg-faint'}`}
              />
            ))}
            <span className="ms-1 font-medium text-fg">{connectedCount}/{statuses.length}</span>
          </span>
        </Link>
      </div>
    </aside>
  );
}
