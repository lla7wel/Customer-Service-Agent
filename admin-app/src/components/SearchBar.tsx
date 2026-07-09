'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Megaphone, MessageSquare, Package, Search, User } from 'lucide-react';

interface SearchItem {
  id: string;
  type: 'product' | 'conversation' | 'customer' | 'campaign';
  title: string;
  subtitle: string;
  href: string;
}

const ICONS = {
  product: Package,
  conversation: MessageSquare,
  customer: User,
  campaign: Megaphone,
};

/** Global search across products, conversations, customers and campaigns. */
export default function SearchBar({ placeholder, ar = false }: { placeholder: string; ar?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SearchItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(-1); // keyboard-highlighted row
  const boxRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onPointer = (ev: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(ev.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, []);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setRows([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError(false); setActive(-1);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok) throw new Error('search_failed');
        const data = await res.json().catch(() => ({ rows: [] }));
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setOpen(true);
      } catch {
        if (!ctrl.signal.aborted) { setRows([]); setError(true); setOpen(true); }
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [q]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || rows.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Escape') { setOpen(false); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); go(rows[active].href); }
  }

  function go(href: string) {
    setOpen(false);
    setQ('');
    router.push(href);
  }

  return (
    <form
      ref={boxRef}
      onSubmit={(e) => {
        e.preventDefault();
        if (rows[0]) go(rows[0].href);
        else router.push(`/products${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
      }}
      className="relative hidden w-full max-w-lg md:block"
    >
      <Search size={15} className="pointer-events-none absolute inset-y-0 my-auto start-3 text-faint" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => q.trim().length >= 2 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        dir="auto"
        className="input ps-9 h-9"
      />
      {loading && <Loader2 size={14} className="absolute end-3 top-2.5 animate-spin text-faint" />}
      {open && q.trim().length >= 2 && (
        <div className="absolute top-11 z-50 w-full overflow-hidden rounded-lg border border-line bg-elevated shadow-2xl">
          {error ? (
            <div className="px-3 py-3 text-sm text-danger">{ar ? 'تعذّر البحث — حاول مجددًا' : 'Search failed — try again'}</div>
          ) : rows.length === 0 && !loading ? (
            <div className="px-3 py-3 text-sm text-faint">{ar ? 'لا توجد نتائج' : 'No matches'}</div>
          ) : (
            <div className="max-h-96 overflow-auto py-1">
              {rows.map((row, idx) => {
                const Icon = ICONS[row.type];
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => go(row.href)}
                    onMouseEnter={() => setActive(idx)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-start transition ${idx === active ? 'bg-surface2' : 'hover:bg-surface2'}`}
                  >
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface2 text-accent">
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg" dir="auto">{row.title}</span>
                      <span className="block truncate text-[11px] text-faint" dir="auto">{row.subtitle || row.type}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </form>
  );
}
