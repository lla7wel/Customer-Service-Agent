'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ImageIcon, Megaphone } from 'lucide-react';
import { Card, Notice, SectionTitle } from '@/components/ui';
import type { Locale } from '@/lib/i18n/config';

const RATIOS = ['1:1', '4:5', '9:16', '16:9'];

export default function CampaignBuilder({ locale }: { locale: Locale }) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [form, setForm] = useState({ name: '', objective: '', caption: '', image_text: '', aspect_ratio: '1:1', target_channel: 'facebook_instagram' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function create() {
    if (!form.name.trim() || !form.objective.trim()) { setError(ar ? 'الاسم والهدف مطلوبان' : 'Campaign name and objective are required'); return; }
    setSaving(true); setError(null);
    const res = await fetch('/api/campaigns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...form, generated_caption: form.caption || null }) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok && data.id) router.push(`/campaigns/${data.id}`); else setError(data.error || 'Failed');
  }

  return <div className="space-y-4">
    <Notice>{ar ? 'أسلوب الصورة والهوية والإضاءة والخط تأتي تلقائياً من AI Control. هنا تدخل معلومات هذه الحملة فقط.' : 'Visual identity, lighting, composition and typography come from AI Control. Enter only this campaign’s variables here.'}</Notice>
    <Card>
      <SectionTitle icon={Megaphone} title={ar ? 'محتوى الحملة' : 'Campaign content'} />
      <div className="grid gap-4 lg:grid-cols-2">
        <L label={ar ? 'اسم الحملة الداخلي' : 'Internal campaign name'}><input value={form.name} onChange={(e) => set('name', e.target.value)} className="input" dir="auto" /></L>
        <L label={ar ? 'هدف الحملة' : 'Campaign objective'}><input value={form.objective} onChange={(e) => set('objective', e.target.value)} className="input" dir="auto" placeholder={ar ? 'مثال: إبراز مجموعة مفارش جديدة' : 'e.g. Introduce a new bedding collection'} /></L>
      </div>
      <L label={ar ? 'كابشن المنشور (لن يُعاد كتابته تلقائياً)' : 'Post caption (preserved as entered)'}><textarea value={form.caption} onChange={(e) => set('caption', e.target.value)} rows={4} className="input resize-y" dir="auto" /></L>
      <L label={ar ? 'النص المطلوب داخل الصورة بالضبط' : 'Exact text requested inside the image'}><input value={form.image_text} onChange={(e) => set('image_text', e.target.value)} className="input" dir="auto" /></L>
      <div className="grid gap-4 sm:grid-cols-2">
        <L label={ar ? 'نسبة الصورة' : 'Aspect ratio'}><select value={form.aspect_ratio} onChange={(e) => set('aspect_ratio', e.target.value)} className="input">{RATIOS.map((ratio) => <option key={ratio}>{ratio}</option>)}</select></L>
        <L label={ar ? 'القناة المستهدفة' : 'Target channel'}><select value={form.target_channel} onChange={(e) => set('target_channel', e.target.value)} className="input"><option value="facebook_instagram">Facebook + Instagram</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="story">Story / Reel</option></select></L>
      </div>
      <div className="mt-4 flex items-center gap-3"><button onClick={create} disabled={saving} className="btn-primary"><ImageIcon size={15} />{saving ? '…' : ar ? 'إنشاء واختيار الصورة' : 'Create & choose image'}<ArrowRight size={15} className="rtl-flip" /></button>{error && <span className="text-sm text-danger">{error}</span>}</div>
    </Card>
  </div>;
}

function L({ label, children }: { label: string; children: React.ReactNode }) { return <label className="mb-3 block"><span className="mb-1 block text-xs font-medium text-muted">{label}</span>{children}</label>; }
