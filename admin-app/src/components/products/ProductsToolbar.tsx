'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Search, LayoutGrid, List, X } from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';

/** Search + category filter + view toggle. Updates the URL (server re-queries). */
export default function ProductsToolbar({
  categories,
  locale,
}: {
  categories: string[];
  locale: Locale;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const activeCat = params.get('category') ?? '';
  const view = params.get('view') === 'list' ? 'list' : 'grid';
  const statusF = params.get('status') ?? 'active';
  const imagesF = params.get('images') ?? 'with';

  function setParam(key: string, val: string) {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (val) sp.set(key, val);
    else sp.delete(key);
    sp.delete('page');
    router.replace(`${pathname}?${sp.toString()}`);
  }

  function setView(v: 'grid' | 'list') {
    const sp = new URLSearchParams(Array.from(params.entries()));
    sp.set('view', v);
    router.replace(`${pathname}?${sp.toString()}`);
  }

  // debounce search → URL
  useEffect(() => {
    const id = setTimeout(() => {
      const sp = new URLSearchParams(Array.from(params.entries()));
      if (q.trim()) sp.set('q', q.trim());
      else sp.delete('q');
      sp.delete('page');
      const next = `${pathname}?${sp.toString()}`;
      if (next !== `${pathname}?${params.toString()}`) router.replace(next);
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function setCategory(cat: string) {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (cat) sp.set('category', cat);
    else sp.delete('category');
    sp.delete('page');
    router.replace(`${pathname}?${sp.toString()}`);
  }

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute inset-y-0 my-auto inset-s-3 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={ar ? 'بحث بالاسم، الكود، الباركود…' : 'Search name, code, barcode…'}
            dir="auto"
            className="input ps-9"
          />
          {q && (
            <button onClick={() => setQ('')} className="absolute inset-y-0 my-auto inset-e-2 text-faint hover:text-fg">
              <X size={15} />
            </button>
          )}
        </div>
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          <button onClick={() => setView('grid')} className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${view === 'grid' ? 'bg-surface2 text-fg' : 'text-faint hover:text-fg'}`}>
            <LayoutGrid size={15} />
          </button>
          <button onClick={() => setView('list')} className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${view === 'list' ? 'bg-surface2 text-fg' : 'text-faint hover:text-fg'}`}>
            <List size={15} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{ar ? 'الحالة' : 'Status'}:</span>
        <CatChip label={ar ? 'الكل' : 'All'} active={statusF === 'all'} onClick={() => setParam('status', 'all')} />
        <CatChip label={ar ? 'فعّال' : 'Active'} active={statusF === 'active'} onClick={() => setParam('status', 'active')} />
        <CatChip label={ar ? 'بحاجة لمراجعة' : 'Needs review'} active={statusF === 'review'} onClick={() => setParam('status', 'review')} />
        <span className="ms-3 text-[11px] font-medium uppercase tracking-wide text-faint">{ar ? 'الصور' : 'Images'}:</span>
        <CatChip label={ar ? 'الكل' : 'All'} active={imagesF === 'all'} onClick={() => setParam('images', 'all')} />
        <CatChip label={ar ? 'بصور' : 'With images'} active={imagesF === 'with'} onClick={() => setParam('images', 'with')} />
        <CatChip label={ar ? 'بدون صور' : 'Missing images'} active={imagesF === 'missing'} onClick={() => setParam('images', 'missing')} />
      </div>

      {categories.length > 0 && (
        <div className="scroll-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <CatChip label={ar ? 'الكل' : 'All'} active={!activeCat} onClick={() => setCategory('')} />
          {categories.map((c) => (
            <CatChip key={c} label={c} active={activeCat === c} onClick={() => setCategory(c)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CatChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`min-h-11 shrink-0 rounded-full border px-3 py-2 text-xs font-medium transition ${
        active ? 'border-accent/40 bg-accent/12 text-accent' : 'border-line bg-surface text-muted hover:text-fg'
      }`}
    >
      {label}
    </button>
  );
}
