'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Save, Wand2, ImageIcon } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import type { Locale } from '@/lib/i18n/config';

export default function CaptionPanel({
  campaignId,
  caption,
  captionPrompt,
  designPrompt,
  locale,
}: {
  campaignId: string;
  caption: string | null;
  captionPrompt: string | null;
  designPrompt: string | null;
  locale: Locale;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [prompt, setPrompt] = useState(captionPrompt ?? '');
  const [text, setText] = useState(caption ?? '');
  const [busy, setBusy] = useState<'gen' | 'save' | null>(null);
  const [msg, setMsg] = useState<{ k: 'ok' | 'info' | 'err'; t: string } | null>(null);

  // Design prompt (text brief for image generation) — never auto-published.
  const [design, setDesign] = useState(designPrompt ?? '');
  const [dBusy, setDBusy] = useState<'gen' | 'save' | null>(null);
  const [dMsg, setDMsg] = useState<{ k: 'ok' | 'info' | 'err'; t: string } | null>(null);

  async function call(action: string, extra: Record<string, unknown> = {}) {
    const res = await fetch(`/api/campaigns/${campaignId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    return { res, d: await res.json().catch(() => ({})) };
  }

  async function generate() {
    setBusy('gen');
    setMsg(null);
    const { res, d } = await call('generate_caption', { prompt });
    setBusy(null);
    if (res.ok && d.caption) {
      setText(d.caption);
      setMsg({ k: 'ok', t: ar ? 'تم توليد التعليق بالليبية' : 'Libyan caption generated' });
      router.refresh();
    } else if (res.status === 503) {
      setMsg({ k: 'info', t: (ar ? 'الذكاء غير مربوط: ' : 'AI not connected: ') + (d?.missing?.join(', ') || 'GEMINI_API_KEY') });
    } else setMsg({ k: 'err', t: d?.error || 'Failed' });
  }

  async function save() {
    setBusy('save');
    const { res } = await call('update', { generated_caption: text, caption_prompt: prompt });
    setBusy(null);
    if (res.ok) {
      setMsg({ k: 'ok', t: ar ? 'تم الحفظ' : 'Saved' });
      router.refresh();
    }
  }

  async function generateDesign() {
    setDBusy('gen');
    setDMsg(null);
    const { res, d } = await call('generate_design_prompt', { brief: design });
    setDBusy(null);
    if (res.ok && d.design_prompt) {
      setDesign(d.design_prompt);
      setDMsg({ k: 'ok', t: ar ? 'تم توليد برومبت التصميم' : 'Design prompt generated' });
      router.refresh();
    } else if (res.status === 503) {
      setDMsg({ k: 'info', t: (ar ? 'الذكاء غير مربوط: ' : 'AI not connected: ') + (d?.missing?.join(', ') || 'GEMINI_API_KEY') });
    } else setDMsg({ k: 'err', t: d?.error || 'Failed' });
  }

  async function saveDesign() {
    setDBusy('save');
    const { res } = await call('update', { design_prompt: design });
    setDBusy(null);
    if (res.ok) {
      setDMsg({ k: 'ok', t: ar ? 'تم الحفظ' : 'Saved' });
      router.refresh();
    }
  }

  return (
    <Card>
      <SectionTitle icon={Sparkles} title={ar ? 'التعليق (Libyan)' : 'Caption (Libyan)'} />
      <label className="mb-1 block text-xs font-medium text-muted">{ar ? 'برومبت التعليق' : 'Caption prompt'}</label>
      <input value={prompt} onChange={(e) => setPrompt(e.target.value)} dir="auto" placeholder={ar ? 'مثال: عرض رمضان على أطقم الفناجين' : 'e.g. Ramadan offer on coffee sets'} className="input mb-3" />
      <div className="relative">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} dir="auto" placeholder={ar ? 'سيظهر التعليق هنا…' : 'Caption appears here…'} className="input resize-y" />
      </div>
      {msg && <p className={`mt-2 text-xs ${msg.k === 'ok' ? 'text-success' : msg.k === 'info' ? 'text-info' : 'text-danger'}`}>{msg.t}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={generate} disabled={busy !== null} className="btn-ghost"><Wand2 size={15} className="text-accent" /> {busy === 'gen' ? '…' : ar ? 'توليد بالذكاء' : 'Generate with AI'}</button>
        <button onClick={save} disabled={busy !== null || !text} className="btn-subtle"><Save size={15} /> {busy === 'save' ? '…' : ar ? 'حفظ' : 'Save'}</button>
      </div>

      {/* Design prompt for image generation */}
      <div className="mt-5 border-t border-line pt-4">
        <SectionTitle icon={ImageIcon} title={ar ? 'برومبت تصميم الصورة' : 'Image design prompt'} />
        <p className="mb-2 text-[11px] text-faint">{ar ? 'وصف نصّي لتوليد صورة الحملة. ولّد صورة فعلية من «المختبر». لا يُنشر تلقائياً.' : 'A text brief for the campaign image. Generate the actual image in the Playground. Never auto-published.'}</p>
        <textarea value={design} onChange={(e) => setDesign(e.target.value)} rows={4} dir="auto" placeholder={ar ? 'مثال: صورة أنيقة لأطقم فناجين على خلفية فاتحة…' : 'e.g. An elegant flat-lay of coffee sets on a light background…'} className="input resize-y" />
        {dMsg && <p className={`mt-2 text-xs ${dMsg.k === 'ok' ? 'text-success' : dMsg.k === 'info' ? 'text-info' : 'text-danger'}`}>{dMsg.t}</p>}
        <div className="mt-3 flex gap-2">
          <button onClick={generateDesign} disabled={dBusy !== null} className="btn-ghost"><Wand2 size={15} className="text-accent" /> {dBusy === 'gen' ? '…' : ar ? 'توليد برومبت' : 'Generate prompt'}</button>
          <button onClick={saveDesign} disabled={dBusy !== null || !design} className="btn-subtle"><Save size={15} /> {dBusy === 'save' ? '…' : ar ? 'حفظ' : 'Save'}</button>
        </div>
      </div>
    </Card>
  );
}
