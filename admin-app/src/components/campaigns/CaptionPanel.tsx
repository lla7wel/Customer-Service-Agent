'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Sparkles } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import type { Locale } from '@/lib/i18n/config';

export default function CaptionPanel({ campaignId, caption, objective, imageText, aspectRatio, targetChannel, locale }: { campaignId: string; caption: string | null; objective: string; imageText: string; aspectRatio: string; targetChannel: string; locale: Locale }) {
  const ar = locale === 'ar'; const router = useRouter();
  const [values, setValues] = useState({ objective, caption: caption ?? '', image_text: imageText, aspect_ratio: aspectRatio, target_channel: targetChannel });
  const [busy, setBusy] = useState<'save' | 'generate' | null>(null); const [message, setMessage] = useState<string | null>(null);
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  async function call(action: string, extra: Record<string, unknown> = {}) { const res = await fetch(`/api/campaigns/${campaignId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...extra }) }); return { res, data: await res.json().catch(() => ({})) }; }
  async function save() { setBusy('save'); const { res, data } = await call('update', { objective: values.objective, generated_caption: values.caption, image_text: values.image_text, aspect_ratio: values.aspect_ratio, target_channel: values.target_channel }); setBusy(null); setMessage(res.ok ? (ar ? 'تم الحفظ' : 'Saved') : data.error || 'Failed'); if (res.ok) router.refresh(); }
  async function generateCaption() { setBusy('generate'); const { res, data } = await call('generate_caption', { objective: values.objective }); setBusy(null); if (res.ok) { set('caption', data.caption); setMessage(ar ? 'تم توليد كابشن قابل للتعديل' : 'Editable caption generated'); router.refresh(); } else setMessage(data.error || 'Failed'); }
  return <Card>
    <SectionTitle icon={Sparkles} title={ar ? 'محتوى الحملة' : 'Campaign content'} />
    <L label={ar ? 'هدف الحملة' : 'Campaign objective'}><textarea value={values.objective} onChange={(e) => set('objective', e.target.value)} rows={2} className="input resize-y" dir="auto" /></L>
    <L label={ar ? 'كابشن المنشور' : 'Post caption'}><textarea value={values.caption} onChange={(e) => set('caption', e.target.value)} rows={5} className="input resize-y" dir="auto" /></L>
    <p className="mb-3 text-[11px] text-faint">{ar ? 'يُحفظ النص اليدوي كما هو. استخدم التوليد فقط عندما تريد كابشن جديد.' : 'Manual caption text is preserved exactly. Generate only when you want new copy.'}</p>
    <L label={ar ? 'النص المطلوب داخل الصورة بالضبط' : 'Exact text requested inside image'}><input value={values.image_text} onChange={(e) => set('image_text', e.target.value)} className="input" dir="auto" /></L>
    <div className="grid gap-3 sm:grid-cols-2"><L label={ar ? 'نسبة الصورة' : 'Aspect ratio'}><select value={values.aspect_ratio} onChange={(e) => set('aspect_ratio', e.target.value)} className="input">{['1:1', '4:5', '9:16', '16:9'].map((r) => <option key={r}>{r}</option>)}</select></L><L label={ar ? 'القناة' : 'Channel'}><select value={values.target_channel} onChange={(e) => set('target_channel', e.target.value)} className="input"><option value="facebook_instagram">Facebook + Instagram</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="story">Story / Reel</option></select></L></div>
    {message && <p className="mb-2 text-xs text-muted">{message}</p>}
    <div className="flex flex-wrap gap-2"><button onClick={generateCaption} disabled={busy !== null || !values.objective.trim()} className="btn-ghost"><Sparkles size={14} />{busy === 'generate' ? '…' : ar ? 'توليد كابشن جديد' : 'Generate new caption'}</button><button onClick={save} disabled={busy !== null} className="btn-primary"><Save size={14} />{busy === 'save' ? '…' : ar ? 'حفظ المحتوى' : 'Save content'}</button></div>
  </Card>;
}
function L({ label, children }: { label: string; children: React.ReactNode }) { return <label className="mb-3 block"><span className="mb-1 block text-xs font-medium text-muted">{label}</span>{children}</label>; }
