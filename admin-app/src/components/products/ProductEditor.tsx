'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Check, Lock } from 'lucide-react';
import type { Product } from '@integrations/db/rows';
import type { Locale } from '@/lib/i18n/config';

export default function ProductEditor({ product, locale }: { product: Product; locale: Locale }) {
  const ar = locale === 'ar';
  const router = useRouter();
  const locks = product.admin_locked_fields ?? {};
  const isLocked = (field: string) => locks[field] === true;
  const [form, setForm] = useState({
    libyan_display_name: product.libyan_display_name ?? '',
    arabic_name: product.arabic_name ?? '',
    english_name: product.english_name ?? '',
    category: product.category ?? '',
    subcategory: product.subcategory ?? '',
    base_price: product.base_price?.toString() ?? '',
    status: product.status as string,
    search_keywords: (product.search_keywords ?? []).join(', '),
    arabic_keywords: (product.arabic_keywords ?? []).join(', '),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch(`/api/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...form,
        base_price: form.base_price === '' ? null : Number(form.base_price),
        search_keywords: splitList(form.search_keywords),
        arabic_keywords: splitList(form.arabic_keywords),
      }),
    });
    setSaving(false);
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else {
      setMsg((d?.missing?.join(', ') || d?.error || 'Failed') as string);
    }
  }

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">{ar ? 'تعديل المنتج' : 'Edit product'}</h3>
        <button onClick={save} disabled={saving} className="btn-primary">
          {saved ? <Check size={15} /> : <Save size={15} />}
          {saving ? '…' : saved ? (ar ? 'تم الحفظ' : 'Saved') : ar ? 'حفظ' : 'Save'}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={ar ? 'الاسم الليبي المعروض' : 'Libyan display name'} value={form.libyan_display_name} onChange={(v) => set('libyan_display_name', v)} locked={isLocked('libyan_display_name')} ar={ar} />
        <Field label={ar ? 'الاسم العربي' : 'Arabic name'} value={form.arabic_name} onChange={(v) => set('arabic_name', v)} locked={isLocked('arabic_name')} ar={ar} />
        <Field label={ar ? 'الاسم الإنجليزي' : 'English name'} value={form.english_name} onChange={(v) => set('english_name', v)} locked={isLocked('english_name')} ar={ar} />
        <Field label={ar ? 'الفئة' : 'Category'} value={form.category} onChange={(v) => set('category', v)} locked={isLocked('category')} ar={ar} />
        <Field label={ar ? 'الفئة الفرعية' : 'Subcategory'} value={form.subcategory} onChange={(v) => set('subcategory', v)} locked={isLocked('subcategory')} ar={ar} />
        <Field label={ar ? 'السعر الأساسي (LYD)' : 'Base price (LYD)'} value={form.base_price} onChange={(v) => set('base_price', v)} type="number" locked={isLocked('base_price')} ar={ar} />
        <Select label={ar ? 'الحالة' : 'Status'} value={form.status} onChange={(v) => set('status', v)} options={[['active', ar ? 'فعّال' : 'active'], ['draft', ar ? 'مسودة' : 'draft'], ['out_of_stock', ar ? 'نفد' : 'out of stock'], ['archived', ar ? 'مؤرشف' : 'archived']]} locked={isLocked('status')} ar={ar} />
      </div>
      <Field className="mt-3" label={ar ? 'كلمات البحث (مفصولة بفواصل)' : 'Search keywords (comma-separated)'} value={form.search_keywords} onChange={(v) => set('search_keywords', v)} locked={isLocked('search_keywords')} ar={ar} />
      <Field className="mt-3" label={ar ? 'كلمات عربية (مفصولة بفواصل)' : 'Arabic keywords (comma-separated)'} value={form.arabic_keywords} onChange={(v) => set('arabic_keywords', v)} locked={isLocked('arabic_keywords')} ar={ar} />

      {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}
      <div className="fixed inset-x-0 bottom-[68px] z-30 border-t border-line bg-surface/95 p-3 backdrop-blur md:hidden">
        <button onClick={save} disabled={saving} className="btn-primary w-full">
          {saved ? <Check size={15} /> : <Save size={15} />}
          {saving ? '…' : saved ? (ar ? 'تم الحفظ' : 'Saved') : ar ? 'حفظ تغييرات المنتج' : 'Save product changes'}
        </button>
      </div>
    </div>
  );
}

function splitList(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

function LockHint({ ar }: { ar: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[10px] font-medium text-muted"
      title={ar ? 'تم تعديله بواسطة المشرف — لن تستبدله المزامنة أو الذكاء الاصطناعي' : 'Edited by admin — sync/matching/AI will not overwrite it'}
    >
      <Lock size={11} />
      {ar ? 'مقفل' : 'locked'}
    </span>
  );
}

function Field({ label, value, onChange, type = 'text', className = '', locked = false, ar = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; className?: string; locked?: boolean; ar?: boolean }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 flex items-center justify-between text-xs font-medium text-muted">
        {label}
        {locked && <LockHint ar={ar} />}
      </span>
      <input type={type} value={value} dir="auto" onChange={(e) => onChange(e.target.value)} className="input" />
    </label>
  );
}

function Select({ label, value, onChange, options, locked = false, ar = false }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; locked?: boolean; ar?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-xs font-medium text-muted">
        {label}
        {locked && <LockHint ar={ar} />}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input">
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}
