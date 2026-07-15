'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CircleAlert, Eye, Loader2, Save, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui';
import type { AiBehavior } from '@integrations/db/rows';
import type { Locale } from '@/lib/i18n/config';

const SECTION_ORDER = [
  'brand_identity', 'customer_service', 'reply_language', 'product_recommendation',
  'image_matching', 'memory_summary', 'human_handoff', 'campaign_caption',
  'campaign_image', 'product_preservation', 'image_typography', 'memory_context',
  'missing_price', 'advanced_task_instructions',
];

const INFO: Record<string, { en: string; ar: string; tasks: string[] }> = {
  brand_identity: { en: 'Master brand personality shared by service and marketing.', ar: 'شخصية العلامة الرئيسية المشتركة بين خدمة العملاء والتسويق.', tasks: ['customer_reply', 'recommendation', 'handoff', 'campaign_caption'] },
  customer_service: { en: 'Customer-service tone, greetings, length and formatting.', ar: 'نبرة خدمة العملاء والترحيب وطول وتنسيق الرد.', tasks: ['customer_reply', 'handoff'] },
  reply_language: { en: 'Language, dialect and writing style. No hidden language rule is added later.', ar: 'اللغة واللهجة وأسلوب الكتابة. لا تُضاف قاعدة لغة مخفية لاحقاً.', tasks: ['customer_reply', 'recommendation', 'handoff', 'campaign_caption'] },
  product_recommendation: { en: 'Recommendation, comparison and relevant upselling behavior.', ar: 'سلوك الاقتراح والمقارنة والبيع الإضافي المناسب.', tasks: ['customer_reply', 'product_recommendation'] },
  image_matching: { en: 'Task-relevant guidance for vision extraction and candidate ranking.', ar: 'توجيهات مطابقة الصور واستخراج خصائص المنتج وترتيب المرشحين.', tasks: ['vision_describe', 'vision_rank', 'image_verify'] },
  memory_summary: { en: 'How conversation memories are summarized for future turns.', ar: 'كيفية تلخيص المحادثات للردود المستقبلية.', tasks: ['memory_summary'] },
  human_handoff: { en: 'Wording and information collection when a teammate must take over.', ar: 'صياغة التحويل للموظف والمعلومات المطلوب جمعها.', tasks: ['handoff_reply'] },
  campaign_caption: { en: 'Master campaign-copy and caption behavior.', ar: 'التوجيه الرئيسي لكتابة الحملات والكابشن.', tasks: ['campaign_caption'] },
  campaign_image: { en: 'Master English Home visual identity, art direction and campaign aesthetics.', ar: 'الهوية البصرية الرئيسية والتوجيه الفني للحملات.', tasks: ['campaign_image'] },
  product_preservation: { en: 'How generated scenes must preserve the supplied product.', ar: 'كيفية الحفاظ على المنتج الأصلي داخل المشهد المولد.', tasks: ['campaign_image', 'image_verify'] },
  image_typography: { en: 'Arabic typography and exact requested text inside campaign images.', ar: 'الخط العربي والنص المطلوب داخل صور الحملات.', tasks: ['campaign_image', 'image_verify'] },
  memory_context: { en: 'Store facts, branches, hours and operating policies.', ar: 'حقائق المتجر والفروع وساعات العمل والسياسات.', tasks: ['customer_reply', 'recommendation', 'handoff'] },
  missing_price: { en: 'Configurable wording when verified information is unavailable.', ar: 'صياغة الرد عند غياب السعر أو المعلومة المؤكدة.', tasks: ['customer_reply', 'recommendation'] },
  advanced_task_instructions: { en: 'Optional advanced instructions appended to every task. Use carefully.', ar: 'تعليمات متقدمة اختيارية تُطبق على كل مهمة. استخدمها بحذر.', tasks: ['all tasks'] },
};

const PREVIEW_TASKS = ['customer_reply', 'product_recommendation', 'handoff_reply', 'vision_describe', 'vision_rank', 'memory_summary', 'campaign_caption', 'campaign_image', 'campaign_image_verify'];

const DISPLAY_TITLE: Record<string, { en: string; ar: string }> = {
  memory_context: { en: 'Store Facts and Policies', ar: 'حقائق وسياسات المتجر' },
  memory_summary: { en: 'Memory and Conversation Context', ar: 'ذاكرة وسياق المحادثة' },
};

export default function AiBehaviors({ behaviors, locale, geminiConnected }: { behaviors: AiBehavior[]; locale: Locale; geminiConnected: boolean }) {
  const ar = locale === 'ar';
  const rows = useMemo(() => [...behaviors].sort((a, b) => {
    const ai = SECTION_ORDER.indexOf(a.behavior_key); const bi = SECTION_ORDER.indexOf(b.behavior_key);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  }), [behaviors]);
  const [task, setTask] = useState('customer_reply');
  const [preview, setPreview] = useState<any>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const loadPreview = useCallback(async () => {
    setPreviewBusy(true); setPreviewError(null);
    const res = await fetch(`/api/ai/behaviors?task=${encodeURIComponent(task)}`);
    const data = await res.json().catch(() => ({}));
    setPreviewBusy(false);
    if (res.ok) setPreview(data.preview); else setPreviewError(data.error || 'Preview failed');
  }, [task]);
  useEffect(() => { void loadPreview(); }, [loadPreview]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={`rounded-xl border px-4 py-3 text-sm ${geminiConnected ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'}`}>
          {geminiConnected ? (ar ? 'Gemini متصل' : 'Gemini connected') : (ar ? 'Gemini غير متصل' : 'Gemini not connected')}
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface2 px-4 py-3 text-sm text-muted">
          <ShieldCheck size={16} className="text-accent" />
          {ar ? 'النص المحفوظ يصل للمهمة كما هو؛ الحقائق والصلاحيات فقط ثابتة في النظام.' : 'Saved text reaches its task word-for-word; only truth and permissions remain immutable.'}
        </div>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Eye size={15} className="text-accent" />{ar ? 'معاينة البرومبت الفعّال' : 'Effective compiled prompt'}</h2>
            <p className="text-xs text-faint">{ar ? 'نفس المترجم المستخدم في الإنتاج، بدون بيانات عميل.' : 'The production compiler output, with no customer data.'}</p>
          </div>
          <select value={task} onChange={(e) => setTask(e.target.value)} className="input w-auto text-sm">
            {PREVIEW_TASKS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {previewBusy ? <Loader2 size={18} className="animate-spin text-accent" /> : previewError ? (
          <p className="flex items-center gap-2 text-sm text-danger"><CircleAlert size={15} />{previewError}</p>
        ) : preview ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-[11px] text-muted">
              <span className="chip">~{preview.approximate_tokens} tokens</span><span className="chip">trace {preview.trace_id}</span>
              <span className="chip">{preview.generation_settings?.modelClass} · temp {preview.generation_settings?.temperature}</span>
              {(preview.contributors ?? []).map((c: any) => <span key={c.behavior_key} className="chip">{c.title}</span>)}
            </div>
            <details><summary className="cursor-pointer text-xs font-semibold text-muted">{ar ? 'السياسة الثابتة' : 'Immutable policy'}</summary><pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface2 p-3 text-xs">{preview.immutable_policy}</pre></details>
            <details open><summary className="cursor-pointer text-xs font-semibold text-muted">{ar ? 'تعليمات AI Control الدقيقة' : 'Exact AI Control instructions'}</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-surface2 p-3 text-xs" dir="auto">{preview.editable_instructions || '—'}</pre></details>
            <p className="text-[11px] text-faint">{ar ? 'بيانات التشغيل والأدوات والمخطط تُضاف منفصلة وقت التنفيذ ولا تظهر هنا.' : 'Runtime data, tools and output schema are attached separately at execution time.'}</p>
          </div>
        ) : null}
      </Card>

      <div className="space-y-4">{rows.map((behavior) => <BehaviorCard key={behavior.id} behavior={behavior} ar={ar} onSaved={loadPreview} />)}</div>
    </div>
  );
}

function BehaviorCard({ behavior, ar, onSaved }: { behavior: AiBehavior; ar: boolean; onSaved: () => void }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(behavior.prompt ?? '');
  const [rules, setRules] = useState(behavior.rules ?? '');
  const [memory, setMemory] = useState(behavior.memory ?? '');
  const [enabled, setEnabled] = useState(behavior.enabled);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const info = INFO[behavior.behavior_key] ?? { en: 'Production AI behavior section.', ar: 'قسم سلوك مستخدم في الإنتاج.', tasks: [] };
  const chars = prompt.length + rules.length + memory.length;
  const warnings = [!prompt.trim() && !rules.trim() && !memory.trim() ? (ar ? 'القسم فارغ' : 'Section is empty') : null, chars > 12_000 ? (ar ? 'التعليمات طويلة جداً' : 'Instructions are very long') : null].filter(Boolean);

  async function save() {
    setState('saving'); setError(null);
    const res = await fetch('/api/ai/behaviors', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: behavior.id, prompt, rules, memory, enabled }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setState('error'); setError(data.error || 'Save failed'); return; }
    setState('saved'); router.refresh(); onSaved();
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-sm font-semibold">{DISPLAY_TITLE[behavior.behavior_key]?.[ar ? 'ar' : 'en'] || behavior.title}</h3><p className="text-xs text-faint">{ar ? info.ar : info.en}</p><p className="mt-1 text-[11px] text-accent">{info.tasks.join(' · ')}</p></div>
        <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setState('idle'); }} />{ar ? 'مفعّل' : 'Enabled'}</label>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Field label={ar ? 'التعليمات' : 'Prompt'} value={prompt} onChange={(v) => { setPrompt(v); setState('idle'); }} />
        <Field label={ar ? 'القواعد' : 'Rules'} value={rules} onChange={(v) => { setRules(v); setState('idle'); }} />
        <Field label={ar ? 'الذاكرة / الحقائق' : 'Memory / facts'} value={memory} onChange={(v) => { setMemory(v); setState('idle'); }} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-warning">{warnings.join(' · ')}</div>
        <div className="flex items-center gap-2">{error && <span className="text-xs text-danger">{error}</span>}<span className="text-[11px] text-faint">{chars} chars · ~{Math.ceil(chars / 4)} tokens</span><button onClick={save} disabled={state === 'saving'} className="btn-primary">{state === 'saving' ? <Loader2 size={14} className="animate-spin" /> : state === 'saved' ? <Check size={14} /> : <Save size={14} />}{state === 'saved' ? (ar ? 'تم الحفظ' : 'Saved') : (ar ? 'حفظ' : 'Save')}</button></div>
      </div>
    </Card>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-medium text-muted">{label}</span><textarea value={value} onChange={(e) => onChange(e.target.value)} rows={7} dir="auto" className="input resize-y leading-relaxed" /></label>;
}
