'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ImageOff, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui';
import type { Locale } from '@/lib/i18n/config';

interface Correction {
  id: string;
  customer_image_url: string | null;
  outcome: string;
  ai_top_score: number | null;
  notes: string | null;
  created_at: string;
  ai_suggested_product_ids?: string[] | null;
  corrected_product_id?: string | null;
}

interface ProductRow {
  id: string;
  product_code: string | null;
  code?: string | null;
  name: string;
  original_name?: string | null;
  price: number | null;
  image: string | null;
}

export default function ImageReviewClient({
  rows,
  locale,
}: {
  rows: Correction[];
  locale: Locale;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [selected, setSelected] = useState<Correction | null>(null);
  const [suggested, setSuggested] = useState<ProductRow[]>([]);
  const [results, setResults] = useState<ProductRow[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ k: 'ok' | 'err' | 'info'; t: string } | null>(null);

  const visibleRows = useMemo(() => rows, [rows]);

  useEffect(() => {
    if (!selected) return;
    const ids = selected.ai_suggested_product_ids ?? [];
    setSuggested([]);
    setResults([]);
    setQuery('');
    setNotice(null);
    if (!ids.length) return;
    fetch(`/api/products/search?ids=${encodeURIComponent(ids.join(','))}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setSuggested(d.rows ?? []))
      .catch(() => setSuggested([]));
  }, [selected]);

  async function searchProducts(value: string) {
    setQuery(value);
    if (!value.trim()) { setResults([]); return; }
    const res = await fetch(`/api/products/search?q=${encodeURIComponent(value)}`, { cache: 'no-store' });
    const d = await res.json().catch(() => ({ rows: [] }));
    setResults(d.rows ?? []);
  }

  async function save(product: ProductRow) {
    if (!selected) return;
    setBusy(true);
    setNotice(null);
    const res = await fetch(`/api/image-review/${selected.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId: product.id }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setNotice({ k: 'ok', t: ar ? 'تم حفظ التصحيح والتعلّم منه' : 'Correction saved and learned' });
      router.refresh();
    } else {
      setNotice({ k: 'err', t: data?.error || 'Failed' });
    }
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visibleRows.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelected(c)}
            className="group overflow-hidden rounded-lg border border-line bg-surface text-start transition hover:border-accent/50 hover:bg-elevated"
          >
            <div className="aspect-4/3 bg-surface2">
              <ReviewImage url={c.customer_image_url} ar={ar} mode="thumb" />
            </div>
            <div className="space-y-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <Badge tone={tone(c.outcome)}>{label(c.outcome, ar)}</Badge>
                <span className="ltr-nums text-xs text-faint">{new Date(c.created_at).toLocaleString(ar ? 'ar-LY' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">{ar ? 'اقتراحات' : 'Suggestions'}</span>
                <span className="text-fg">{c.ai_suggested_product_ids?.length ?? 0}</span>
              </div>
              <span className="inline-flex text-xs font-medium text-accent">{ar ? 'فتح ومراجعة' : 'Open and review'}</span>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/70 p-3 backdrop-blur-xs sm:p-6">
          <div className="mx-auto grid h-full max-w-6xl overflow-hidden rounded-lg border border-line bg-bg shadow-2xl lg:grid-cols-[minmax(0,1.25fr)_420px]">
            <div className="scroll-thin min-h-0 overflow-auto bg-black/25 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-fg">{ar ? 'صورة العميل' : 'Customer image'}</p>
                  <p className="text-xs text-faint">{label(selected.outcome, ar)}</p>
                </div>
                <button onClick={() => setSelected(null)} className="btn-subtle h-9 w-9 p-0"><X size={16} /></button>
              </div>
              <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-line bg-black/30">
                <ReviewImage url={selected.customer_image_url} ar={ar} mode="large" />
              </div>
            </div>

            <aside className="scroll-thin min-h-0 overflow-y-auto border-s border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-fg">{ar ? 'اختيار المنتج الصحيح' : 'Choose the correct product'}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {ar ? 'اختيارك هنا يحفظ التصحيح ويستخدمه النظام في المطابقات القادمة.' : 'Saving here updates the correction record and teaches future image matching.'}
              </p>

              {notice && (
                <p className={`mt-3 rounded-lg border px-3 py-2 text-xs ${notice.k === 'ok' ? 'border-success/30 bg-success/10 text-success' : notice.k === 'info' ? 'border-info/30 bg-info/10 text-info' : 'border-danger/30 bg-danger/10 text-danger'}`}>
                  {notice.t}
                </p>
              )}

              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{ar ? 'اقتراحات النظام' : 'Suggested matches'}</p>
                <div className="space-y-2">
                  {suggested.length ? suggested.map((p) => <ProductChoice key={p.id} p={p} ar={ar} busy={busy} onSave={save} />) : (
                    <p className="rounded-lg border border-line bg-surface2 px-3 py-4 text-center text-xs text-faint">{ar ? 'لا توجد اقتراحات محفوظة' : 'No saved suggestions'}</p>
                  )}
                </div>
              </div>

              <div className="mt-5">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-faint">{ar ? 'بحث يدوي' : 'Manual search'}</label>
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute inset-y-0 inset-s-3 my-auto text-faint" />
                  <input
                    value={query}
                    onChange={(e) => searchProducts(e.target.value)}
                    placeholder={ar ? 'اسم، كود، لون…' : 'Name, code, color…'}
                    dir="auto"
                    className="input h-10 ps-9"
                  />
                </div>
                <div className="mt-2 space-y-2">
                  {results.map((p) => <ProductChoice key={p.id} p={p} ar={ar} busy={busy} onSave={save} />)}
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}
    </>
  );
}

function ReviewImage({ url, ar, mode }: { url: string | null; ar: boolean; mode: 'thumb' | 'large' }) {
  const [ok, setOk] = useState(!!url);
  if (!url || !ok) {
    return (
      <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-1 text-faint">
        <ImageOff size={mode === 'large' ? 30 : 22} />
        <span className="text-xs">{ar ? 'الصورة غير متاحة' : 'Image unavailable'}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className={mode === 'large' ? 'max-h-[76vh] max-w-full rounded-md object-contain' : 'h-full w-full object-cover transition group-hover:scale-[1.02]'}
      loading="lazy"
      onError={() => setOk(false)}
    />
  );
}

function ProductChoice({ p, ar, busy, onSave }: { p: ProductRow; ar: boolean; busy: boolean; onSave: (p: ProductRow) => void }) {
  return (
    <div className="flex min-w-0 gap-3 rounded-lg border border-line bg-bg p-2.5">
      <span className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-line bg-surface2">
        {p.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="flex h-full items-center justify-center text-faint"><ImageOff size={16} /></span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="wrap-break-word text-sm font-semibold leading-snug text-fg" dir="auto">{p.name}</p>
        {p.original_name && <p className="mt-0.5 truncate text-[11px] text-muted" title={p.original_name}>{p.original_name}</p>}
        <p className="mt-1 text-xs text-faint">
          {p.code || p.product_code ? <span className="font-mono">{p.code ?? p.product_code}</span> : null}
          <span className="ltr-nums ms-2 text-success">{p.price != null ? `${p.price} د.ل` : (ar ? 'بدون سعر' : 'no price')}</span>
        </p>
      </div>
      <button onClick={() => onSave(p)} disabled={busy} className="btn-primary h-8 px-2.5 text-xs" title={ar ? 'حفظ التصحيح' : 'Save correction'}>
        <Check size={13} />
      </button>
    </div>
  );
}

function tone(outcome: string): 'good' | 'bad' | 'info' | 'neutral' {
  if (outcome === 'corrected' || outcome === 'exact') return 'good';
  if (outcome === 'none') return 'bad';
  if (outcome === 'multiple') return 'info';
  return 'neutral';
}

function label(outcome: string, ar: boolean): string {
  const labels: Record<string, [string, string]> = {
    none: ['None', 'لا يوجد تطابق'],
    multiple: ['Multiple', 'عدة احتمالات'],
    corrected: ['Corrected', 'تم التصحيح'],
    exact: ['Exact', 'تطابق واضح'],
  };
  const l = labels[outcome] ?? [outcome, outcome];
  return ar ? l[1] : l[0];
}
