'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Inbox, Package, Clapperboard, MoreHorizontal, SlidersHorizontal, Settings, X, Activity } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import LanguageSwitcher from './LanguageSwitcher';
import LogoutButton from './LogoutButton';
import type { Locale } from '@/lib/i18n/config';
import type { Theme } from '@/lib/theme';
import type { IntegrationStatus } from '@integrations/status';

const PRIMARY = [
  { href: '/dashboard', ar: 'الرئيسية', en: 'Home', icon: LayoutDashboard },
  { href: '/inbox', ar: 'الرسائل', en: 'Inbox', icon: Inbox },
  { href: '/catalog', ar: 'الكتالوج', en: 'Catalog', icon: Package },
  { href: '/content-studio', ar: 'المحتوى', en: 'Studio', icon: Clapperboard },
];

export default function MobileNav({ locale, theme, userEmail, statuses }: {
  locale: Locale; theme: Theme; userEmail?: string | null; statuses: IntegrationStatus[];
}) {
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  const ar = locale === 'ar';
  useEffect(() => setMore(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = more ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [more]);
  useEffect(() => {
    if (!more) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMore(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [more]);
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const connected = statuses.filter((s) => s.configured).length;
  return (
    <>
      <nav className="safe-b fixed inset-x-0 bottom-0 z-40 grid h-[calc(4.25rem+env(safe-area-inset-bottom))] grid-cols-5 border-t border-line bg-surface/96 px-1 backdrop-blur-xl md:hidden" aria-label={ar ? 'التنقل الرئيسي' : 'Primary navigation'}>
        {PRIMARY.map((item) => {
          const Icon = item.icon;
          const isActive = active(item.href);
          return <Link key={item.href} href={item.href} className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium transition ${isActive ? 'text-accent' : 'text-muted'}`}>
            <span className={`flex h-7 w-12 items-center justify-center rounded-full ${isActive ? 'bg-accent/10' : ''}`}><Icon size={19} /></span>
            <span className="truncate">{ar ? item.ar : item.en}</span>
          </Link>;
        })}
        <button onClick={() => setMore(true)} className={`flex flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium ${more || ['/ai-control', '/settings'].some(active) ? 'text-accent' : 'text-muted'}`}>
          <span className="flex h-7 w-12 items-center justify-center rounded-full"><MoreHorizontal size={20} /></span>
          {ar ? 'المزيد' : 'More'}
        </button>
      </nav>
      {more && <div className="fixed inset-0 z-50 md:hidden">
        <button className="absolute inset-0 bg-black/35 backdrop-blur-sm" onClick={() => setMore(false)} aria-label="Close" />
        <section className="safe-b absolute inset-x-0 bottom-0 max-h-[86dvh] animate-fade-in overflow-y-auto rounded-t-3xl border-t border-line bg-surface p-5 shadow-2xl">
          <div className="mb-5 flex items-center justify-between">
            <div><p className="text-base font-bold text-fg">{ar ? 'المزيد' : 'More'}</p><p className="text-xs text-muted">{userEmail || (ar ? 'مشرف' : 'Admin')}</p></div>
            <button onClick={() => setMore(false)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface2 text-muted" aria-label="Close"><X size={19} /></button>
          </div>
          <div className="mb-5 grid gap-2">
            <MoreLink href="/ai-control" icon={SlidersHorizontal} label={ar ? 'تحكّم الذكاء والاختبار' : 'AI Control & testing'} />
            <MoreLink href="/settings" icon={Settings} label={ar ? 'الإعدادات والفريق' : 'Settings & team'} />
            <MoreLink href="/settings?tab=activity" icon={Activity} label={ar ? 'النشاط والأخطاء' : 'Activity & errors'} />
          </div>
          <div className="mb-5 rounded-2xl border border-line bg-surface2/60 p-4">
            <div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold text-fg">{ar ? 'حالة الأنظمة' : 'System status'}</span><span className="text-xs text-muted">{connected}/{statuses.length}</span></div>
            <div className="space-y-2">{statuses.map((s) => <div key={s.key} className="flex items-center justify-between text-xs"><span className="text-muted">{s.label}</span><span className={s.configured ? 'text-success' : 'text-warning'}>{s.configured ? (ar ? 'متصل' : 'Connected') : (ar ? 'يحتاج إعداد' : 'Setup')}</span></div>)}</div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-line p-3"><ThemeToggle initial={theme} /><LanguageSwitcher locale={locale} /><LogoutButton label={ar ? 'خروج' : 'Sign out'} /></div>
        </section>
      </div>}
    </>
  );
}

function MoreLink({ href, icon: Icon, label }: { href: string; icon: typeof Settings; label: string }) {
  return <Link href={href} className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface2/50 px-4 text-sm font-semibold text-fg"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><Icon size={18} /></span>{label}</Link>;
}
