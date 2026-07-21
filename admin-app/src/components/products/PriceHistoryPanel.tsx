'use client';

import { useEffect, useState } from 'react';
import { History, Loader2, TrendingDown } from 'lucide-react';

interface HistoryRow {
  id: number; old_price: number | null; new_price: number | null; source: string;
  note: string | null; effective_at: string; changed_by_username: string | null;
}
interface OpenPromotion {
  id: string; promo_price: number; previous_price: number; ends_at: string | null; status: string;
}

const SOURCE_AR: Record<string, string> = {
  manual: 'تعديل يدوي',
  csv_import: 'استيراد CSV',
  promotion_start: 'بداية عرض',
  promotion_end: 'نهاية عرض',
  migration: 'رصيد افتتاحي',
};

/** Verified price history — the "before" source for every price-drop visual. */
export default function PriceHistoryPanel({ productId, ar }: { productId: string; ar: boolean }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [promo, setPromo] = useState<OpenPromotion | null>(null);

  useEffect(() => {
    fetch(`/api/products/${productId}/history`)
      .then((r) => r.json())
      .then((d) => { setRows(d.history ?? []); setPromo(d.open_promotion ?? null); })
      .catch(() => setRows([]));
  }, [productId]);

  return (
    <div className="card p-4">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
        <History size={14} /> {ar ? 'تاريخ السعر' : 'Price history'}
      </h3>
      {promo && (
        <div className="mb-3 rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-semibold text-accent">
            <TrendingDown size={14} /> {ar ? 'عرض مفتوح' : 'Open promotion'}
          </p>
          <p className="mt-1 text-xs text-muted" dir="auto">
            {promo.promo_price} د.ل ({ar ? 'قبل' : 'was'} {promo.previous_price})
            {promo.ends_at
              ? ` — ${ar ? 'ينتهي' : 'ends'} ${new Date(promo.ends_at).toLocaleString('ar-LY')}`
              : ` — ${ar ? 'بدون نهاية محددة' : 'no end date'}`}
          </p>
        </div>
      )}
      {rows === null ? (
        <div className="flex h-16 items-center justify-center text-muted"><Loader2 size={16} className="animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{ar ? 'لا يوجد تاريخ بعد.' : 'No history yet.'}</p>
      ) : (
        <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
          {rows.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface2/50 px-2.5 py-1.5">
              <span className="ltr-nums font-semibold text-fg">
                {h.old_price != null ? <span className="me-1 text-xs text-faint line-through">{h.old_price}</span> : null}
                {h.new_price != null ? `${h.new_price} د.ل` : '—'}
              </span>
              <span className="min-w-0 flex-1 truncate text-end text-xs text-muted" dir="auto">
                {ar ? (SOURCE_AR[h.source] ?? h.source) : h.source}
                {h.changed_by_username ? ` · ${h.changed_by_username}` : ''}
              </span>
              <span className="shrink-0 text-[10px] text-faint" dir="ltr">
                {new Date(h.effective_at).toLocaleDateString('en-GB')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
