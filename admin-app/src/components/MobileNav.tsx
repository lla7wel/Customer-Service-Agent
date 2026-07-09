'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { NAV } from '@/lib/nav';
import { translate } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';

/**
 * Mobile navigation (Phase 8): a hamburger that opens a slide-in drawer with the
 * full nav. Visible only below the md breakpoint, where the desktop sidebar is
 * hidden. Inbox-first ordering follows NAV. Closes on route change.
 */
export default function MobileNav({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = (k: string) => translate(locale, k);

  // Close on navigation.
  useEffect(() => { setOpen(false); }, [pathname]);
  // Lock body scroll while open.
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const CATALOG_REVIEW_PATHS = ['/catalog-review', '/catalog-match', '/image-review', '/price-review'];
  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/';
    if (href === '/catalog-review') return CATALOG_REVIEW_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(true)}
        aria-label={locale === 'ar' ? 'القائمة' : 'Menu'}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface/80 text-fg shadow-card backdrop-blur-md"
      >
        <Menu size={18} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          {/* backdrop */}
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setOpen(false)} />
          {/* drawer */}
          <div className="safe-b absolute inset-y-0 start-0 flex w-72 max-w-[86%] animate-fade-in flex-col border-e border-line bg-surface/95 shadow-xl backdrop-blur-xl">
            <div className="safe-t flex h-16 items-center justify-between border-b border-line/70 px-4">
              <span className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-accent-grad text-xs font-bold text-black">EH</span>
                <span className="text-sm font-semibold text-fg">{t('app_subtitle')}</span>
              </span>
              <button onClick={() => setOpen(false)} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface2">
                <X size={18} />
              </button>
            </div>
            <nav className="scroll-thin flex-1 overflow-y-auto px-3 py-4">
              {NAV.map((group) => (
                <div key={group.titleKey} className="mb-5">
                  <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{t(group.titleKey)}</p>
                  <ul className="space-y-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = isActive(item.href);
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                              active
                                ? 'border border-accent/25 bg-accent/12 font-medium text-accent shadow-glow'
                                : 'border border-transparent text-muted hover:border-line hover:bg-surface2 hover:text-fg'
                            }`}
                          >
                            <Icon size={18} className={active ? 'text-accent' : 'text-faint'} />
                            <span>{t(item.labelKey)}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
