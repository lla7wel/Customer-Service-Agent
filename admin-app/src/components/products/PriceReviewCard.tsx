'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ImageOff, Check, Hash, Barcode, Tag, Globe, ArrowUpRight, Languages } from 'lucide-react';

export interface ReviewItem {
  id: string;
  product_code: string;
  barcode: string | null;
  /** Existing Arabic/English catalog name, if any (NOT the Turkish source). */
  catalogName: string | null;
  english_name: string | null;
  arabic_name: string | null;
  category: string | null;
  /** Turkish scraped name — reference only, to help the admin translate. */
  source_name: string | null;
  website_url: string | null;
  image: string | null;
}

export default function PriceReviewCard({ item, ar }: { item: ReviewItem; ar: boolean }) {
  const router = useRouter();
  const [price, setPrice] = useState('');
  const [en, setEn] = useState(item.english_name ?? '');
  const [arName, setArName] = useState(item.arabic_name ?? '');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hasName = !!(en.trim() || arName.trim() || item.catalogName);

  async function save() {
    const value = Number(price);
    if (!Number.isFinite(value) || value <= 0) {
      setErr(ar ? 'أدخل سعراً صحيحاً' : 'Enter a valid price');
      return;
    }
    if (!hasName) {
      setErr(ar ? 'أدخل اسماً عربياً أو إنجليزياً' : 'Enter an Arabic or English name');
      return;
    }
    setSaving(true);
    setErr(null);
    const res = await fetch(`/api/products/${item.id}/price`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_price: value, english_name: en.trim(), arabic_name: arName.trim() }),
    });
    setSaving(false);
    if (res.ok) {
      setDone(true);
      setTimeout(() => router.refresh(), 700);
    } else {
      const d = await res.json().catch(() => ({}));
      setErr((d?.error as string) || 'Failed');
    }
  }

  return (
    <div className={`card flex flex-col overflow-hidden p-0 transition ${done ? 'opacity-50' : ''}`}>
      <div className="relative aspect-square w-full bg-surface2">
        {item.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-faint"><ImageOff size={24} /></div>
        )}
        <Link
          href={`/products/${item.id}`}
          className="absolute inset-e-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 text-white transition hover:bg-black/70"
          title={ar ? 'فتح المنتج' : 'Open product'}
        >
          <ArrowUpRight size={14} />
        </Link>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        {/* Turkish source name — reference only, to help translation */}
        {item.source_name && (
          <p className="flex items-start gap-1.5 text-xs text-faint" dir="auto" title={ar ? 'الاسم المصدر (تركي)' : 'Source name (Turkish)'}>
            <Languages size={12} className="mt-0.5 shrink-0" />
            <span className="line-clamp-2">{item.source_name}</span>
          </p>
        )}

        <dl className="space-y-1 text-xs text-faint">
          <div className="flex items-center gap-1.5"><Hash size={11} /><span className="truncate font-mono">{item.product_code}</span></div>
          {item.barcode && <div className="flex items-center gap-1.5"><Barcode size={11} /><span className="truncate font-mono">{item.barcode}</span></div>}
          {item.category && <div className="flex items-center gap-1.5"><Tag size={11} /><span className="truncate">{item.category}</span></div>}
          {item.website_url && (
            <a href={item.website_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-accent hover:underline">
              <Globe size={11} /> {ar ? 'مصدر السكرابر' : 'Scraper source'}
            </a>
          )}
        </dl>

        {/* Arabic/English name + price entry */}
        <div className="mt-auto space-y-2 pt-2">
          <input
            value={en}
            onChange={(e) => { setEn(e.target.value); setErr(null); }}
            placeholder={ar ? 'الاسم الإنجليزي' : 'English name'}
            dir="ltr"
            className="input text-sm"
            disabled={done}
          />
          <input
            value={arName}
            onChange={(e) => { setArName(e.target.value); setErr(null); }}
            placeholder={ar ? 'الاسم العربي' : 'Arabic name'}
            dir="rtl"
            className="input text-sm"
            disabled={done}
          />
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="number"
                inputMode="decimal"
                value={price}
                onChange={(e) => { setPrice(e.target.value); setErr(null); }}
                onKeyDown={(e) => e.key === 'Enter' && save()}
                placeholder={ar ? 'السعر' : 'Price'}
                className="input pe-10"
                disabled={done}
              />
              <span className="pointer-events-none absolute inset-y-0 inset-e-3 flex items-center text-xs text-faint">LYD</span>
            </div>
            <button onClick={save} disabled={saving || done} className="btn-primary shrink-0">
              {done ? <Check size={15} /> : null}
              {done ? (ar ? 'تم' : 'Done') : saving ? '…' : ar ? 'تفعيل' : 'Activate'}
            </button>
          </div>
          {err && <p className="text-xs text-danger">{err}</p>}
        </div>
      </div>
    </div>
  );
}
