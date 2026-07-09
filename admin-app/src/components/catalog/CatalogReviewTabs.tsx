'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Images, ImageIcon, Tags } from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';

/** Paths that belong to the unified Catalog Review Center. */
export const CATALOG_REVIEW_PATHS = ['/catalog-review', '/catalog-match', '/image-review', '/price-review'];

const TABS = [
  { href: '/catalog-match', icon: Images, en: 'Matches', ar: 'المطابقات' },
  { href: '/image-review', icon: ImageIcon, en: 'Image Review', ar: 'مراجعة الصور' },
  { href: '/price-review', icon: Tags, en: 'Prices', ar: 'الأسعار' },
];

/**
 * Persistent segmented tab bar shown on every Catalog Review page, so the three
 * review tools (scraper↔catalog matches, customer-image review, price review)
 * feel like one section.
 */
export default function CatalogReviewTabs({ locale }: { locale: Locale }) {
  const ar = locale === 'ar';
  const pathname = usePathname();
  return (
    <div className="mb-5">
      <div className="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-line bg-surface/80 p-1.5 shadow-card backdrop-blur-md">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = pathname === t.href || pathname.startsWith(t.href + '/');
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                active ? 'bg-accent/15 text-accent shadow-glow' : 'text-muted hover:bg-surface2 hover:text-fg'
              }`}
            >
              <Icon size={15} />
              {ar ? t.ar : t.en}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
