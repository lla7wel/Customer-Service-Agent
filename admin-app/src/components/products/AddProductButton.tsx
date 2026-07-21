'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';

/**
 * Admin-only manual product creation. The admin catalog is the price source of
 * truth, so a product entered with a price is active (customer-visible) right
 * away; without one it lands in price review. POSTs to /api/products.
 */
export default function AddProductButton({ locale }: { locale: Locale }) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    product_code: '', barcode: '', libyan_display_name: '', english_name: '',
    category: '', base_price: '', website_url: '',
  });

  function set<K extends keyof typeof f>(k: K, v: string) {
    setF((cur) => ({ ...cur, [k]: v }));
  }

  async function save() {
    setSaving(true); setErr(null);
    const payload: Record<string, unknown> = {
      product_code: f.product_code.trim(),
      barcode: f.barcode.trim() || null,
      libyan_display_name: f.libyan_display_name.trim() || null,
      english_name: f.english_name.trim() || null,
      category: f.category.trim() || null,
      website_url: f.website_url.trim() || null,
    };
    const price = parseFloat(f.base_price);
    if (Number.isFinite(price)) payload.base_price = price;

    const res = await fetch('/api/products', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok && data.id) {
      setOpen(false);
      router.push(`/catalog/${data.id}`);
    } else {
      const map: Record<string, string> = {
        product_code_required: ar ? 'الكود مطلوب' : 'Product code required',
        name_required: ar ? 'الاسم مطلوب' : 'A name is required',
        product_code_exists: ar ? 'الكود موجود مسبقاً' : 'That product code already exists',
      };
      setErr(map[data.error] || data.error || (ar ? 'فشل الحفظ' : 'Failed to save'));
    }
  }

  const canSave = f.product_code.trim() && (f.libyan_display_name.trim() || f.english_name.trim());

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Plus size={15} /> {ar ? 'إضافة منتج' : 'Add product'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="card relative z-10 w-full max-w-md p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-fg">{ar ? 'إضافة منتج جديد' : 'Add a product'}</h2>
              <button onClick={() => setOpen(false)} className="btn-subtle h-8 w-8 p-0"><X size={15} /></button>
            </div>
            <div className="space-y-3">
              <Field label={ar ? 'الكود *' : 'Product code *'}>
                <input value={f.product_code} onChange={(e) => set('product_code', e.target.value)} className="input" placeholder="EH-0001" />
              </Field>
              <Field label={ar ? 'الاسم بالعربي/الليبي' : 'Arabic / Libyan name'}>
                <input value={f.libyan_display_name} onChange={(e) => set('libyan_display_name', e.target.value)} dir="auto" className="input" />
              </Field>
              <Field label={ar ? 'الاسم بالإنجليزي' : 'English name'}>
                <input value={f.english_name} onChange={(e) => set('english_name', e.target.value)} dir="auto" className="input" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={ar ? 'الفئة' : 'Category'}>
                  <input value={f.category} onChange={(e) => set('category', e.target.value)} dir="auto" className="input" />
                </Field>
                <Field label={ar ? 'السعر (د.ل)' : 'Price (LYD)'}>
                  <input value={f.base_price} onChange={(e) => set('base_price', e.target.value)} inputMode="decimal" className="input ltr-nums" placeholder="—" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={ar ? 'الباركود' : 'Barcode'}>
                  <input value={f.barcode} onChange={(e) => set('barcode', e.target.value)} className="input ltr-nums" />
                </Field>
                <Field label={ar ? 'رابط الموقع' : 'Website URL'}>
                  <input value={f.website_url} onChange={(e) => set('website_url', e.target.value)} dir="ltr" className="input" />
                </Field>
              </div>
              <p className="text-xs text-faint">
                {ar
                  ? 'بسعر ← يصبح فعّالاً للعملاء. بدون سعر ← يذهب لمراجعة الأسعار.'
                  : 'With a price it goes live for customers. Without one it lands in price review.'}
              </p>
              {err && <p className="text-xs text-danger">{err}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setOpen(false)} className="btn-ghost">{ar ? 'إلغاء' : 'Cancel'}</button>
                <button onClick={save} disabled={!canSave || saving} className="btn-primary">
                  {saving ? '…' : ar ? 'حفظ' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
