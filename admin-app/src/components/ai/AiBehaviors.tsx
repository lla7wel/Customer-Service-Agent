'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Save, Check, Loader2, Bot, Package, Brain, Megaphone, ImageIcon, Play,
  ShieldCheck, CircleCheck, CircleAlert, ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui';
import type { AiBehavior } from '@integrations/db/rows';
import type { Locale } from '@/lib/i18n/config';

interface BehaviorMeta {
  icon: any; ar: string; en: string; hint_ar: string; hint_en: string;
  fields: ('prompt' | 'rules' | 'memory')[];
  sample?: { ar: string; en: string };
  playgroundOnly?: boolean;
}

// Only these behaviors are admin-editable. Everything else (reply language,
// missing-price guardrail, image matching, vector/tool usage, CSV truth) is
// system-controlled in code so it can't be misconfigured.
const META: Record<string, BehaviorMeta> = {
  customer_service: { icon: Bot, ar: 'سلوك خدمة العملاء', en: 'Customer Service Behavior', hint_ar: 'نبرة المساعد، طريقة الرد، وقواعد خدمة العملاء في ماسنجر.', hint_en: 'Assistant tone, reply style, and customer-service behavior in Messenger.', fields: ['prompt', 'rules'], sample: { ar: 'وقتاش يفتح المحل؟', en: 'What are your opening hours?' } },
  product_recommendation: { icon: Package, ar: 'اقتراح المنتجات', en: 'Product recommendations', hint_ar: 'قواعد داخلية لكيفية اقتراح المنتجات من بيانات الكتالوج.', hint_en: 'Advanced rules for suggesting products from real catalog data.', fields: ['rules'], sample: { ar: 'أبغي هدية للمطبخ', en: 'I want a kitchen gift' } },
  memory_context: { icon: Brain, ar: 'معلومات المتجر والحقائق', en: 'Store info & facts', hint_ar: 'حقائق ثابتة يتذكرها المساعد دائماً (المواقع، التوصيل، السياسات).', hint_en: 'Durable facts the assistant always knows (locations, delivery, policies).', fields: ['memory'], sample: { ar: 'وين موقعكم؟', en: 'Where are you located?' } },
  campaign_caption: { icon: Megaphone, ar: 'الذكاء التسويقي / الحملات', en: 'Campaign / Marketing AI', hint_ar: 'نبرة وأسلوب كتابة منشورات الحملات والكابشنات.', hint_en: 'Tone and style for campaign captions and marketing copy.', fields: ['rules'], sample: { ar: 'عرض رمضان على أطقم الفناجين', en: 'Ramadan offer on coffee sets' } },
  campaign_image: { icon: ImageIcon, ar: 'تصميم صور الحملات', en: 'Campaign image / design', hint_ar: 'توجيهات متقدمة لتوليد/تعديل صور الحملات.', hint_en: 'Advanced guidance for generating/editing campaign images.', fields: ['prompt'], playgroundOnly: true },
};

const SECTIONS: { ar: string; en: string; keys: string[] }[] = [
  { ar: 'الوضع البسيط', en: 'Simple mode', keys: ['customer_service', 'campaign_caption'] },
];

const ADVANCED_SECTIONS: { ar: string; en: string; keys: string[] }[] = [
  { ar: 'قواعد خدمة العملاء المتقدمة', en: 'Advanced customer-service rules', keys: ['product_recommendation', 'memory_context'] },
  { ar: 'قواعد التصميم المتقدمة', en: 'Advanced creative rules', keys: ['campaign_image'] },
];

export default function AiBehaviors({ behaviors, locale, geminiConnected }: { behaviors: AiBehavior[]; locale: Locale; geminiConnected: boolean }) {
  const ar = locale === 'ar';
  const byKey = new Map(behaviors.map((b) => [b.behavior_key, b]));
  const [showAdvanced, setShowAdvanced] = useState(false);
  return (
    <div className="space-y-6">
      {/* Status + safety banner */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${geminiConnected ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'}`}>
          {geminiConnected ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
          <span>
            {geminiConnected
              ? (ar ? 'Gemini مربوط — يمكنك اختبار كل سلوك.' : 'Gemini connected — you can test every behavior.')
              : (ar ? 'Gemini غير مربوط — أضف GEMINI_API_KEY.' : 'Gemini not connected — add GEMINI_API_KEY.')}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface2 px-4 py-3 text-sm text-muted">
          <ShieldCheck size={16} className="shrink-0 text-accent" />
          <span>{ar ? 'مطابقة المنتجات والصور والأسعار يتحكم بها النظام تلقائياً — هنا فقط الأسلوب والنبرة.' : 'Product/image matching, prices and tools are system-controlled — here you set only style & tone.'}</span>
        </div>
      </div>

      {SECTIONS.map((section) => {
        const cards = section.keys.map((k) => byKey.get(k)).filter(Boolean) as AiBehavior[];
        if (!cards.length) return null;
        return (
          <div key={section.en}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-faint">{ar ? section.ar : section.en}</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {cards.map((b) => <BehaviorCard key={b.id} behavior={b} ar={ar} geminiConnected={geminiConnected} />)}
            </div>
          </div>
        );
      })}

      <div className="rounded-xl border border-line bg-surface2 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">{ar ? 'قواعد متقدمة' : 'Advanced rules'}</h2>
            <p className="text-xs text-faint">
              {ar ? 'للحقائق الثابتة، اقتراح المنتجات، وتوجيهات تصميم الصور.' : 'For durable facts, recommendation rules, and campaign image guidance.'}
            </p>
          </div>
          <button onClick={() => setShowAdvanced((v) => !v)} className="btn-ghost">
            {showAdvanced ? (ar ? 'إخفاء' : 'Hide') : (ar ? 'عرض' : 'Show')}
          </button>
        </div>
      </div>

      {showAdvanced && ADVANCED_SECTIONS.map((section) => {
        const cards = section.keys.map((k) => byKey.get(k)).filter(Boolean) as AiBehavior[];
        if (!cards.length) return null;
        return (
          <div key={section.en}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-faint">{ar ? section.ar : section.en}</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {cards.map((b) => <BehaviorCard key={b.id} behavior={b} ar={ar} geminiConnected={geminiConnected} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BehaviorCard({ behavior, ar, geminiConnected }: { behavior: AiBehavior; ar: boolean; geminiConnected: boolean }) {
  const router = useRouter();
  const meta = META[behavior.behavior_key];
  if (!meta) return null;
  const [prompt, setPrompt] = useState(behavior.prompt ?? '');
  const [rules, setRules] = useState(behavior.rules ?? '');
  const [memory, setMemory] = useState(behavior.memory ?? '');
  const [enabled, setEnabled] = useState(behavior.enabled);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [sample, setSample] = useState(ar ? meta.sample?.ar ?? '' : meta.sample?.en ?? '');
  const [testing, setTesting] = useState(false);
  const [testOut, setTestOut] = useState<string | null>(null);
  const [testErr, setTestErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setMsg(null);
    const res = await fetch('/api/ai/behaviors', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: behavior.id, prompt, rules, memory, enabled }),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) { setSaved(true); router.refresh(); } else setMsg(d?.error || 'Failed');
  }

  async function test() {
    setTesting(true); setTestOut(null); setTestErr(null);
    try {
      await fetch('/api/ai/behaviors', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: behavior.id, prompt, rules, memory, enabled }),
      });
      const res = await fetch('/api/ai/playground', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: behavior.behavior_key, text: sample }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setTestOut(typeof d.reply === 'string' ? d.reply : (typeof d.output === 'string' ? d.output : JSON.stringify(d.output ?? d, null, 2)));
      else if (res.status === 503) setTestErr((ar ? 'غير مربوط: ' : 'Not connected: ') + (d?.missing?.join(', ') || 'GEMINI_API_KEY'));
      else setTestErr((ar ? 'خطأ: ' : 'Error: ') + (d?.error || res.statusText));
    } catch (e: any) {
      setTestErr((ar ? 'خطأ: ' : 'Error: ') + (e?.message || ''));
    } finally { setTesting(false); }
  }

  const Icon = meta.icon;
  return (
    <Card className="flex flex-col">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon size={16} className="text-accent" />
          <div>
            <h3 className="text-sm font-semibold text-fg">{ar ? meta.ar : meta.en}</h3>
            <p className="text-[11px] text-faint">{ar ? meta.hint_ar : meta.hint_en}</p>
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
          <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }} />
          {ar ? 'مُفعّل' : 'Enabled'}
        </label>
      </div>

      <div className="space-y-2">
        {meta.fields.includes('prompt') && <Field label={ar ? 'التعليمات' : 'Prompt'} value={prompt} onChange={(v) => { setPrompt(v); setSaved(false); }} />}
        {meta.fields.includes('rules') && <Field label={ar ? 'قواعد' : 'Rules'} value={rules} onChange={(v) => { setRules(v); setSaved(false); }} />}
        {meta.fields.includes('memory') && <Field label={ar ? 'المعلومات' : 'Info'} value={memory} onChange={(v) => { setMemory(v); setSaved(false); }} rows={4} />}
      </div>

      <div className="mt-3 flex items-center justify-end gap-3">
        {msg && <span className="text-xs text-danger">{msg}</span>}
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
          {saving ? '…' : saved ? (ar ? 'تم' : 'Saved') : ar ? 'حفظ' : 'Save'}
        </button>
      </div>

      <div className="mt-3 border-t border-line pt-3">
        {meta.playgroundOnly ? (
          <Link href="/ai-playground" className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
            <ExternalLink size={13} /> {ar ? 'اختبر في المختبر (يحتاج صورة)' : 'Test in the playground (needs an image)'}
          </Link>
        ) : (
          <>
            <p className="mb-1 text-[11px] font-medium text-muted">{ar ? 'اختبار سريع' : 'Quick test'}</p>
            <div className="flex gap-2">
              <input value={sample} onChange={(e) => setSample(e.target.value)} dir="auto" placeholder={ar ? 'مُدخل تجريبي…' : 'Sample input…'} className="input flex-1" />
              <button onClick={test} disabled={testing || !geminiConnected} className="btn-ghost shrink-0" title={!geminiConnected ? (ar ? 'Gemini غير مربوط' : 'Gemini not connected') : ''}>
                {testing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} className="text-accent" />}
                {ar ? 'اختبار' : 'Test'}
              </button>
            </div>
            {testErr && <p className="mt-2 text-xs text-danger" dir="auto">{testErr}</p>}
            {testOut && (
              <div className="mt-2">
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-surface2 p-2.5 text-xs text-fg" dir="auto">{testOut}</pre>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function Field({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} dir="auto" className="input resize-y leading-relaxed" />
    </label>
  );
}
