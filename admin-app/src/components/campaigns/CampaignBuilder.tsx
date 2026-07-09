'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Megaphone, ArrowRight } from 'lucide-react';
import { Card, SectionTitle, Notice } from '@/components/ui';
import type { Locale } from '@/lib/i18n/config';

const TYPES: [string, string, string][] = [
  ['single_product_discount', 'Single product discount', 'خصم منتج واحد'],
  ['multi_product_carousel', 'Multi-product carousel', 'كاروسيل عدة منتجات'],
  ['category_sale', 'Category sale', 'تخفيض فئة'],
  ['flash_sale', 'Flash sale', 'عرض سريع'],
  ['clearance', 'Clearance', 'تصفية'],
  ['seasonal', 'Seasonal (Ramadan/Eid)', 'موسمي (رمضان/عيد)'],
];

export default function CampaignBuilder({ locale }: { locale: Locale }) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [f, setF] = useState({
    name: '', type: 'single_product_discount', discount_percent: '',
    starts_at: '', ends_at: '', caption_tone: 'friendly, professional',
    design_prompt: '', caption_prompt: '', auto_publish: false,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((s) => ({ ...s, [k]: v }));
  }

  async function create() {
    if (!f.name.trim()) { setMsg(ar ? 'الاسم مطلوب' : 'Name is required'); return; }
    setSaving(true);
    setMsg(null);
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...f,
        discount_percent: f.discount_percent === '' ? null : Number(f.discount_percent),
        starts_at: f.starts_at || null, ends_at: f.ends_at || null, publish_mode: 'manual',
      }),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok && d?.id) router.push(`/campaigns/${d.id}`);
    else setMsg(d?.missing?.join(', ') || d?.error || 'Failed');
  }

  return (
    <div className="space-y-4">
      <Notice>{ar ? 'بعد الإنشاء تنتقل لمساحة البناء: رفع الصور، توليد التعليق، اختيار منشور واحد أو منشورات، ثم النشر.' : 'After creating you go to the builder: upload images, generate a caption, choose one post or multiple, then publish.'}</Notice>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle icon={Megaphone} title={ar ? 'الأساسيات' : 'Basics'} />
          <L label={ar ? 'اسم الحملة' : 'Campaign name'}>
            <input value={f.name} onChange={(e) => set('name', e.target.value)} dir="auto" className="input" placeholder={ar ? 'مثال: تخفيضات رمضان' : 'e.g. Ramadan Sale'} />
          </L>
          <L label={ar ? 'النوع' : 'Type'}>
            <select value={f.type} onChange={(e) => set('type', e.target.value)} className="input">
              {TYPES.map(([v, en, arl]) => <option key={v} value={v}>{ar ? arl : en}</option>)}
            </select>
          </L>
          <L label={ar ? 'نسبة الخصم %' : 'Discount %'}>
            <input type="number" value={f.discount_percent} onChange={(e) => set('discount_percent', e.target.value)} className="input" placeholder="20" />
          </L>
          <div className="grid grid-cols-2 gap-3">
            <L label={ar ? 'البداية' : 'Start'}><input type="datetime-local" value={f.starts_at} onChange={(e) => set('starts_at', e.target.value)} className="input" /></L>
            <L label={ar ? 'النهاية' : 'End'}><input type="datetime-local" value={f.ends_at} onChange={(e) => set('ends_at', e.target.value)} className="input" /></L>
          </div>
          <p className="text-[11px] text-faint">{ar ? 'عند التداخل: الأعلى أولوية يفوز، ثم الأحدث بداية.' : 'On overlap: highest priority wins, then latest start.'}</p>
        </Card>

        <Card>
          <SectionTitle title={ar ? 'الذكاء والتصميم' : 'AI & design'} />
          <L label={ar ? 'نبرة التعليق' : 'Caption tone'}><input value={f.caption_tone} onChange={(e) => set('caption_tone', e.target.value)} dir="auto" className="input" /></L>
          <L label={ar ? 'وصف تصميم الصورة (برومبت)' : 'Image design prompt'}><textarea value={f.design_prompt} onChange={(e) => set('design_prompt', e.target.value)} rows={2} dir="auto" className="input resize-y" /></L>
          <L label={ar ? 'برومبت التعليق' : 'Caption prompt'}><textarea value={f.caption_prompt} onChange={(e) => set('caption_prompt', e.target.value)} rows={2} dir="auto" className="input resize-y" /></L>
          <label className="mt-1 flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={f.auto_publish} onChange={(e) => set('auto_publish', e.target.checked)} className="accent-[rgb(var(--accent))]" />
            {ar ? 'نشر تلقائي للمنشورات المجدولة' : 'Auto-publish scheduled posts'}
          </label>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={create} disabled={saving} className="btn-primary">
          {saving ? '…' : ar ? 'إنشاء ومتابعة' : 'Create & continue'} <ArrowRight size={16} className="rtl-flip" />
        </button>
        {msg && <span className="text-sm text-danger">{msg}</span>}
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
