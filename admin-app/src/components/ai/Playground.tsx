'use client';

import { useState } from 'react';
import {
  MessageSquare, ScanSearch, Megaphone, Wand2, Upload, Play, X, CircleAlert,
  Sparkles, Bug, Send,
} from 'lucide-react';
import { Card } from '@/components/ui';
import type { Locale } from '@/lib/i18n/config';

type Mode = 'customer' | 'image_matching' | 'campaign_caption' | 'campaign_image';

const MODES: { id: Mode; en: string; ar: string; icon: any; needsImage?: boolean; allowsImage?: boolean; ph_en: string; ph_ar: string }[] = [
  { id: 'customer', en: 'Customer turn', ar: 'محادثة عميل', icon: MessageSquare, allowsImage: true, ph_en: 'Customer message, product name, code, barcode, or link…', ph_ar: 'رسالة العميل، اسم منتج، كود، باركود، أو رابط…' },
  { id: 'image_matching', en: 'Image → product', ar: 'مطابقة صورة', icon: ScanSearch, needsImage: true, ph_en: 'Optional text with the image…', ph_ar: 'نص إضافي مع الصورة (اختياري)…' },
  { id: 'campaign_caption', en: 'Campaign caption', ar: 'كابشن حملة', icon: Megaphone, ph_en: 'Campaign description / prompt…', ph_ar: 'وصف الحملة / البرومبت…' },
  { id: 'campaign_image', en: 'Campaign image', ar: 'صورة حملة', icon: Wand2, needsImage: true, ph_en: 'Campaign objective…', ph_ar: 'هدف الحملة…' },
];

export default function Playground({ locale }: { locale: Locale }) {
  const ar = locale === 'ar';
  const [mode, setMode] = useState<Mode>('customer');
  const [text, setText] = useState('');
  const [image, setImage] = useState<{ data: string; mime: string; preview: string } | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [outImage, setOutImage] = useState<string | null>(null);
  const [debug, setDebug] = useState<any | null>(null);
  const [previousImageContext, setPreviousImageContext] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [campaignImageText, setCampaignImageText] = useState('');
  const [campaignRatio, setCampaignRatio] = useState('1:1');

  const active = MODES.find((m) => m.id === mode)!;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const b64 = btoa(binary);
    setImage({ data: b64, mime: file.type, preview: `data:${file.type};base64,${b64}` });
  }

  function reset() { setReply(null); setOutImage(null); setDebug(null); setErr(null); }

  async function run() {
    setBusy(true); reset();
    try {
      const res = await fetch('/api/ai/playground', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          text,
          image: image ? { data: image.data, mime: image.mime } : null,
          campaign: mode === 'campaign_image' ? { objective: text, image_text: campaignImageText, aspect_ratio: campaignRatio, target_channel: 'facebook_instagram' } : undefined,
          previousImageContext: !image && mode === 'customer' ? previousImageContext : null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setReply(typeof d.reply === 'string' ? d.reply : null);
        if (d.image) setOutImage(d.image);
        if (d.debug) {
          setDebug(d.debug);
          const ctx = d.debug?.retrieval?.last_image_context;
          if (ctx?.kind === 'last_image_context') setPreviousImageContext(ctx);
        }
      } else if (res.status === 503) {
        setErr((ar ? 'الذكاء غير مربوط — متغيّر ناقص: ' : 'AI not connected — missing env: ') + (d?.missing?.join(', ') || 'GEMINI_API_KEY'));
      } else if (res.status === 504 || d?.timeout) {
        setErr((ar ? '⏱ انتهت المهلة — النموذج مشغول، جرّب مرة أخرى (يُستخدم نموذج احتياطي تلقائيًا).' : '⏱ Timed out — model busy, try again (a fallback model is used automatically).'));
      } else setErr((ar ? 'خطأ: ' : 'Error: ') + (d?.error || d?.hint || res.statusText));
    } catch (e: any) {
      setErr((ar ? 'خطأ بالشبكة: ' : 'Network error: ') + (e?.message || ''));
    } finally { setBusy(false); }
  }

  return (
    <div>
      {/* mode tabs */}
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-line bg-surface/80 p-1 shadow-card backdrop-blur-md">
        {MODES.map((m) => {
          const Icon = m.icon;
          return (
            <button key={m.id} onClick={() => { setMode(m.id); reset(); }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${mode === m.id ? 'bg-accent-grad text-black shadow-glow' : 'text-muted hover:bg-surface hover:text-fg'}`}>
              <Icon size={15} /> {ar ? m.ar : m.en}
            </button>
          );
        })}
      </div>

      {/* input */}
      <Card className="mb-4 glass">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-fg">{ar ? active.ar : active.en}</p>
            <p className="text-xs text-muted">{ar ? 'أدخل الحالة وشغّل نفس منطق الإنتاج بدون إرسال.' : 'Enter a case and run the production workflow without delivery.'}</p>
          </div>
          <span className="chip bg-accent/12 text-accent ring-accent/25">
            <Send size={12} /> {ar ? 'لا إرسال' : 'No send'}
          </span>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} dir="auto" placeholder={ar ? active.ph_ar : active.ph_en} className="input resize-y" />
        {mode === 'campaign_image' && <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]"><label><span className="mb-1 block text-xs text-muted">{ar ? 'النص المطلوب داخل الصورة بالضبط' : 'Exact text requested inside image'}</span><input value={campaignImageText} onChange={(e) => setCampaignImageText(e.target.value)} className="input" dir="auto" /></label><label><span className="mb-1 block text-xs text-muted">{ar ? 'النسبة' : 'Ratio'}</span><select value={campaignRatio} onChange={(e) => setCampaignRatio(e.target.value)} className="input"><option>1:1</option><option>4:5</option><option>9:16</option><option>16:9</option></select></label></div>}
        {(active.needsImage || active.allowsImage) && (
          <div className="mt-3">
            {image ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.preview} alt="" className="h-24 w-24 rounded-lg border border-line object-cover" />
                <button onClick={() => setImage(null)} className="absolute -inset-e-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-danger text-white"><X size={13} /></button>
              </div>
            ) : (
              <label className="btn-ghost cursor-pointer">
                <Upload size={15} /> {ar ? 'رفع صورة' : 'Upload image'}
                <input type="file" accept="image/*" hidden onChange={onFile} />
              </label>
            )}
          </div>
        )}
        {mode === 'customer' && previousImageContext && !image && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/25 bg-accent/10 px-3 py-2 text-xs text-muted">
            <ScanSearch size={14} className="text-accent" />
            <span>{ar ? 'سياق آخر صورة محفوظ للاختبار: ' : 'Previous image context ready: '}</span>
            <span className="text-fg">{previousImageContext.candidates?.length ?? 0} {ar ? 'خيارات' : 'candidates'}</span>
            <button onClick={() => setPreviousImageContext(null)} className="ms-auto text-faint hover:text-fg">
              {ar ? 'مسح' : 'Clear'}
            </button>
          </div>
        )}
        <button onClick={run} disabled={busy || (active.needsImage && !image)} className="btn-primary mt-3">
          <Play size={15} /> {busy ? (ar ? 'جارٍ…' : 'Running…') : ar ? 'تشغيل الـ workflow' : 'Run workflow'}
        </button>
        {err && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-sm text-danger">
            <CircleAlert size={15} className="mt-0.5 shrink-0" /> <span dir="auto">{err}</span>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        {/* CUSTOMER REPLY (right-hand truth) */}
        <Card className="glass">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-faint">
            <Sparkles size={13} className="text-accent" /> {ar ? 'الرد كما يصل العميل' : 'Exact customer reply'}
          </h3>
          {outImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={outImage} alt="" className="mb-3 w-full rounded-lg border border-line" />
          )}
          {reply == null && !outImage ? (
            <p className="py-8 text-center text-sm text-faint">{ar ? 'الرد يظهر هنا.' : 'The reply appears here.'}</p>
          ) : reply ? (
            <div className="whitespace-pre-wrap wrap-break-word rounded-xl border border-accent/30 bg-accent/10 px-3.5 py-2.5 text-sm leading-relaxed text-fg shadow-card" dir="auto">{reply}</div>
          ) : null}
          {debug?.outcome && (
            <p className="mt-3 text-[11px] text-faint">
              {ar ? 'سيُرسل تلقائياً: ' : 'Would auto-send: '}
              <span className={debug.outcome.would_auto_send ? 'text-success' : 'text-warning'}>{debug.outcome.would_auto_send ? (ar ? 'نعم' : 'Yes') : (ar ? 'لا (Meta غير مربوط)' : 'No (Meta not configured)')}</span>
            </p>
          )}
        </Card>

        {/* TECHNICAL DEBUG */}
        <Card>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-faint">
            <Bug size={13} className="text-accent" /> {ar ? 'التفاصيل التقنية' : 'Technical debug'}
          </h3>
          {!debug ? (
            <p className="py-8 text-center text-sm text-faint">{ar ? 'تفاصيل الـ workflow تظهر هنا.' : 'Workflow internals appear here.'}</p>
          ) : (
            <div className="space-y-3 text-[11px]">
              {debug.input_signals && <Section title={ar ? 'الإشارات المستخرجة' : 'Extracted signals'} obj={debug.input_signals} />}
              {debug.retrieval && (
                <div>
                  <p className="mb-1 font-semibold text-muted">{ar ? 'مرشحو القاعدة' : 'Database candidates'}{debug.retrieval.outcome ? ` · ${debug.retrieval.outcome}` : ''}</p>
                  <div className="space-y-1">
                    {(debug.retrieval.candidates ?? []).slice(0, 8).map((c: any) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 rounded-sm border border-line bg-surface2 px-2 py-1">
                        <span className="min-w-0 truncate text-fg" dir="auto">{c.name}</span>
                        <span className="flex shrink-0 items-center gap-1.5 text-faint">
                          {typeof c.confidence === 'number' && <span>{Math.round(c.confidence * 100)}%</span>}
                          {(c.retrieval_tracks ?? []).length > 0 && <span className="rounded-sm bg-surface px-1 text-[9px]">{c.retrieval_tracks.join(',')}</span>}
                        </span>
                      </div>
                    ))}
                    {(debug.retrieval.candidates ?? []).length === 0 && <p className="text-faint">{ar ? 'لا مرشحين' : 'No candidates'}</p>}
                  </div>
                  {debug.retrieval.diagnostics && <Section title={ar ? 'تشخيص الصورة' : 'Image diagnostics'} obj={debug.retrieval.diagnostics} collapsed />}
                </div>
              )}
              {debug.gemini_calls && <Section title={ar ? 'استدعاءات Gemini/الأدوات' : 'Gemini / tool calls'} obj={debug.gemini_calls} />}
              {debug.task && <Section title={ar ? 'تطابق الإنتاج والبرومبت' : 'Production parity'} obj={{ task: debug.task, production_path: debug.production_path, prompt_trace_id: debug.prompt_trace_id, ai_control_sections: debug.ai_control_sections }} />}
              {debug.memory_used && <Section title={ar ? 'الذاكرة المستخدمة' : 'Memory used'} obj={debug.memory_used} collapsed />}
              {debug.outcome && <Section title={ar ? 'النتيجة' : 'Outcome'} obj={debug.outcome} />}
              {debug.sanitization && <Section title={ar ? 'المُنقّي' : 'Sanitizer'} obj={debug.sanitization} />}
              {typeof debug.total_latency_ms === 'number' && <p className="text-faint">{ar ? 'الزمن الكلي: ' : 'Total latency: '}{debug.total_latency_ms} ms</p>}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Section({ title, obj, collapsed }: { title: string; obj: unknown; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="mb-1 flex w-full items-center justify-between font-semibold text-muted">
        <span>{title}</span><span className="text-faint">{open ? '−' : '+'}</span>
      </button>
      {open && <pre className="max-h-56 overflow-auto whitespace-pre-wrap wrap-break-word rounded-lg bg-surface2 p-2 text-[10px] text-fg" dir="ltr">{JSON.stringify(obj, null, 2)}</pre>}
    </div>
  );
}
