'use client';
/* eslint-disable @next/next/no-img-element -- all media is served by the configured media host */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Archive, ArrowLeft, ArrowRight, CalendarClock, Check, CheckCircle2, ChevronLeft,
  CircleAlert, ImageIcon, Images, Loader2, MessageSquare, PackageSearch,
  RefreshCw, Search, Send, Sparkles, Trash2, Upload, WandSparkles,
} from 'lucide-react';

interface ItemProduct {
  row_id: string; product_id: string; new_price: number | null; show_price: boolean; position: number;
  product_code: string; libyan_display_name: string | null; arabic_name: string | null; english_name: string | null;
  active_price: number | null; base_price: number | null; image_url: string | null;
}
interface Asset {
  id: string; kind: string; public_url: string | null; position: number; product_id: string | null;
  asset_role: string; generation_run_id: string | null; selected_for_publish: boolean;
  config_revision: number | null; aspect_ratio: string | null; source_model: string | null;
}
interface Generation {
  id: string; status: string; stage: string; quality_status: string; config_revision: number;
  source_model: string | null; requested_model: string | null; attempt_count: number;
  warnings: unknown; verification: unknown; last_error: string | null; created_at: string; finished_at: string | null;
}
interface Publication {
  id: string; platform: string; format: string; status: string; provider_post_id: string | null;
  permalink_url: string | null; last_error: string | null; published_at: string | null;
}
interface CommentRow {
  id: string; author_name: string | null; body: string | null; decision: string | null; decision_reason: string | null;
  reply_text: string | null; reply_status: string | null; reply_error: string | null; platform: string; commented_at: string | null;
}
interface Detail { item: any; products: ItemProduct[]; assets: Asset[]; generations: Generation[]; publications: Publication[]; comments: CommentRow[] }

const STEPS = [
  { n: 1, title: 'المصدر', hint: 'الصور والمنتجات' },
  { n: 2, title: 'الغرض', hint: 'نوع التصميم' },
  { n: 3, title: 'النص والتوليد', hint: 'العبارة والكابشن' },
  { n: 4, title: 'المعاينة والنشر', hint: 'الاعتماد النهائي' },
];
const STAGES: Record<string, string> = {
  queued: 'في قائمة الانتظار', analyzing: 'تحليل المنتج', creating: 'إنشاء المشهد',
  verifying_product: 'فحص تطابق المنتج', verifying_text: 'فحص النص والسعر', finished: 'اكتمل', failed: 'تعذّر التوليد',
};
const productName = (p: ItemProduct) => p.libyan_display_name || p.arabic_name || p.english_name || p.product_code;
const warningList = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : [];

export default function ContentEditor({ contentId }: { contentId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [scheduleLocal, setScheduleLocal] = useState('');
  const [warningAccepted, setWarningAccepted] = useState(false);
  const [phraseDirty, setPhraseDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/content/${contentId}`, { cache: 'no-store' });
    if (res.ok) setDetail(await res.json());
  }, [contentId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!detail?.generations?.some((r) => r.status === 'queued' || r.status === 'running')) return;
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [detail?.generations, load]);

  const item = detail?.item;
  const editable = item && ['draft', 'ready', 'failed'].includes(item.status);
  const generating = item?.status === 'generating';
  const currentRun = detail?.generations?.find((r) => r.status === 'queued' || r.status === 'running') ?? detail?.generations?.[0];
  const selectedRun = detail?.generations?.find((r) => r.id === item?.selected_generation_run_id);
  const sourceAssets = detail?.assets.filter((a) => a.asset_role === 'source') ?? [];
  const selectedAssets = detail?.assets.filter((a) => a.asset_role === 'output' && a.selected_for_publish) ?? [];
  const hasSources = Boolean(detail && (detail.products.length || sourceAssets.length));
  const isPriceDrop = item?.purpose === 'price_drop';

  const patch = async (body: Record<string, unknown>, label = 'save') => {
    setBusy(label); setError(null);
    try {
      const res = await fetch(`/api/content/${contentId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || 'تعذّر حفظ التغييرات');
      await load();
    } catch (e: any) { setError(e?.message ?? 'حدث خطأ'); }
    finally { setBusy(null); }
  };

  const saveProducts = (products: ItemProduct[]) => patch({ products: products.map((p) => ({ product_id: p.product_id, new_price: p.new_price, show_price: p.show_price })) }, 'products');
  const runSearch = async (q: string) => {
    setSearch(q);
    if (q.trim().length < 2) return setResults([]);
    const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`);
    if (res.ok) setResults(((await res.json()).rows ?? []).slice(0, 10));
  };
  const addProduct = async (p: any) => {
    if (!detail || detail.products.some((x) => x.product_id === p.id)) return;
    setSearch(''); setResults([]);
    await saveProducts([...detail.products, {
      row_id: '', product_id: p.id, new_price: null, show_price: false, position: detail.products.length,
      product_code: p.product_code ?? p.code ?? '', libyan_display_name: p.name ?? null, arabic_name: null,
      english_name: null, active_price: p.price ?? null, base_price: null, image_url: p.image ?? null,
    }]);
  };
  const uploadFiles = async (files: FileList) => {
    setBusy('upload'); setError(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData(); form.append('file', file);
        const res = await fetch(`/api/content/${contentId}/upload`, { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.detail || data?.error || `تعذّر رفع ${file.name}`);
      }
      await load();
    } catch (e: any) { setError(e?.message ?? 'فشل رفع الصور'); }
    finally { setBusy(null); }
  };
  const generate = async () => {
    setBusy('generate'); setError(null);
    try {
      const res = await fetch(`/api/content/${contentId}/generate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || (data?.problems ?? []).join('، ') || data?.error || 'فشل بدء التوليد');
      setStep(4); await load();
    } catch (e: any) { setError(e?.message ?? 'فشل التوليد'); }
    finally { setBusy(null); }
  };
  const generateCopy = async () => {
    setBusy('copy'); setError(null);
    try {
      const res=await fetch(`/api/content/${contentId}/copy`,{method:'POST'}); const data=await res.json();
      if(!res.ok)throw new Error(data?.detail||data?.error||'فشل توليد النص');
      await load();
    } catch(e:any){setError(e?.message??'فشل توليد النص');}
    finally{setBusy(null);}
  };
  const selectRun = async (runId: string) => {
    setBusy(`select:${runId}`); setError(null);
    const res = await fetch(`/api/content/${contentId}/select`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ generation_run_id: runId }) });
    const data = await res.json();
    if (!res.ok) setError(data?.detail || data?.error || 'تعذّر اختيار النسخة');
    await load(); setBusy(null); setWarningAccepted(false);
  };
  const approve = async (when: 'now' | 'schedule') => {
    setBusy(when); setError(null);
    try {
      const payload = when === 'now' ? { when, acknowledge_quality_warning: warningAccepted } : { when, local: scheduleLocal, acknowledge_quality_warning: warningAccepted };
      const res = await fetch(`/api/content/${contentId}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || 'فشل الاعتماد');
      await load();
    } catch (e: any) { setError(e?.message ?? 'فشل الاعتماد'); }
    finally { setBusy(null); }
  };
  const retryPublication = async (id: string) => {
    setBusy(`retry:${id}`); await fetch(`/api/content/${contentId}/publications/${id}/retry`, { method: 'POST' }); await load(); setBusy(null);
  };

  const canContinue = useMemo(() => {
    if (!detail || !item) return false;
    if (step === 1) return hasSources;
    if (step === 2) return item.platforms?.length && (!isPriceDrop || detail.products.every((p) => Number(p.new_price) > 0));
    if (step === 3) return item.image_text_mode === 'none' || Boolean(item.image_text?.trim());
    return true;
  }, [detail, hasSources, isPriceDrop, item, step]);

  if (!detail || !item) return <EditorSkeleton />;

  return (
    <div className="mx-auto max-w-[1480px] pb-28 lg:pb-8" dir="rtl">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <button onClick={() => router.push('/content-studio')} className="mb-2 inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-fg"><ArrowRight size={16} /> الرجوع للاستوديو</button>
          <div className="flex flex-wrap items-center gap-3">
            <input defaultValue={item.title ?? ''} placeholder="عنوان داخلي للمحتوى" onBlur={(e) => e.target.value !== (item.title ?? '') && patch({ title: e.target.value })} className="min-h-12 min-w-0 rounded-xl border border-line bg-surface px-3 text-lg font-bold text-fg outline-none focus:border-accent sm:w-96" />
            <Status status={item.status} />
          </div>
        </div>
        {item.status !== 'archived' && <button onClick={() => patch({ archive: true }, 'archive').then(() => router.push('/content-studio'))} className="btn-secondary"><Archive size={16} /> أرشفة</button>}
      </header>

      {error && <div role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger"><CircleAlert className="me-2 inline" size={16} />{error}</div>}
      {item.last_error && <div className="mb-4 whitespace-pre-wrap rounded-xl border border-danger/25 bg-danger/6 px-4 py-3 text-sm text-danger">{item.last_error}</div>}

      <div className="mb-5 overflow-x-auto pb-1">
        <ol className="flex min-w-[650px] items-center rounded-2xl border border-line bg-surface p-2 shadow-card">
          {STEPS.map((s, i) => (
            <li key={s.n} className="flex flex-1 items-center">
              <button onClick={() => setStep(s.n)} className={`flex min-h-14 flex-1 items-center gap-3 rounded-xl px-3 text-start transition ${step === s.n ? 'bg-navy text-white' : 'text-muted hover:bg-surface2'}`}>
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${step === s.n ? 'bg-white/15' : s.n < step ? 'bg-success/12 text-success' : 'bg-surface2 text-faint'}`}>{s.n < step ? <Check size={15} /> : s.n}</span>
                <span><strong className="block text-sm">{s.title}</strong><small className={`block ${step === s.n ? 'text-white/65' : 'text-faint'}`}>{s.hint}</small></span>
              </button>
              {i < STEPS.length - 1 && <ChevronLeft size={16} className="mx-1 shrink-0 text-faint" />}
            </li>
          ))}
        </ol>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <main className="min-w-0">
          {step === 1 && <SourceStep detail={detail} editable={editable} search={search} results={results} busy={busy} onSearch={runSearch} onAdd={addProduct} onRemove={(id: string) => saveProducts(detail.products.filter((p) => p.product_id !== id))} onUpload={() => fileRef.current?.click()} />}
          {step === 2 && <PurposeStep detail={detail} editable={editable} patch={patch} saveProducts={saveProducts} />}
          {step === 3 && <CopyStep detail={detail} editable={editable} busy={busy} phraseDirty={phraseDirty} setPhraseDirty={setPhraseDirty} patch={patch} generate={generate} generateCopy={generateCopy} />}
          {step === 4 && <PreviewStep detail={detail} currentRun={currentRun} selectedRun={selectedRun} selectedAssets={selectedAssets} generating={generating} busy={busy} onSelect={selectRun} onGenerate={generate} warningAccepted={warningAccepted} setWarningAccepted={setWarningAccepted} scheduleLocal={scheduleLocal} setScheduleLocal={setScheduleLocal} approve={approve} />}
        </main>
        <aside className="hidden xl:block"><PreviewPanel item={item} assets={selectedAssets} run={currentRun} /></aside>
      </div>

      <input ref={fileRef} hidden multiple type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); e.target.value = ''; }} />

      {detail.publications.length > 0 && <PublicationMonitor rows={detail.publications} busy={busy} retry={retryPublication} />}
      {['published', 'partially_published'].includes(item.status) && <CommentMonitor item={item} rows={detail.comments} patch={patch} />}

      {step < 4 && (
        <div className="fixed inset-x-0 bottom-[68px] z-30 border-t border-line bg-bg/95 p-3 backdrop-blur lg:static lg:mt-5 lg:border-0 lg:bg-transparent lg:p-0">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
            <button onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1} className="btn-secondary disabled:opacity-0"><ArrowRight size={16} /> السابق</button>
            <button onClick={() => setStep(Math.min(4, step + 1))} disabled={!canContinue} className="btn-primary min-w-40">التالي <ArrowLeft size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

function SourceStep({ detail, editable, search, results, busy, onSearch, onAdd, onRemove, onUpload }: any) {
  const sources = detail.assets.filter((a: Asset) => a.asset_role === 'source');
  return <StepCard eyebrow="الخطوة 1 من 4" title="اختر مصادر التصميم" intro="ابدأ بصورك أو منتجات الكتالوج. الاثنين متساويان، ويُستخدمان كمراجع فقط—لن تُنشر صورة مصدر بالخطأ.">
    <div className="grid gap-3 sm:grid-cols-2">
      <button disabled={!editable || busy} onClick={onUpload} className="group min-h-40 rounded-2xl border border-dashed border-line bg-surface2/45 p-5 text-start transition hover:border-navy/40 hover:bg-surface2">
        <span className="mb-5 grid h-11 w-11 place-items-center rounded-xl bg-navy text-white"><Upload size={20} /></span>
        <strong className="block text-base text-fg">رفع صور</strong><span className="mt-1 block text-sm leading-6 text-muted">صورة أو أكثر من جهازك، JPG أو PNG أو WebP.</span>
      </button>
      <div className="min-h-40 rounded-2xl border border-line bg-surface2/45 p-5">
        <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-sand/20 text-navy"><PackageSearch size={20} /></span>
        <strong className="block text-base text-fg">اختيار من الكتالوج</strong>
        <div className="relative mt-3"><Search className="absolute end-3 top-3.5 text-faint" size={17} /><input value={search} onChange={(e) => onSearch(e.target.value)} disabled={!editable} placeholder="الاسم، الكود أو الباركود" className="input pe-10" />
          {results.length > 0 && <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-xl">{results.map((p: any) => <button key={p.id} onClick={() => onAdd(p)} className="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 text-start hover:bg-surface2">{p.image ? <img src={p.image} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <span className="h-10 w-10 rounded-lg bg-surface2" />}<span className="min-w-0 flex-1"><b className="block truncate text-sm text-fg">{p.name}</b><small className="text-muted">{p.code || p.product_code}</small></span>{p.price != null && <b className="text-sm text-navy">{p.price} د.ل</b>}</button>)}</div>}
        </div>
      </div>
    </div>
    {(detail.products.length > 0 || sources.length > 0) && <div className="mt-5"><h3 className="mb-3 text-sm font-bold text-fg">المصادر المختارة</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {detail.products.map((p: ItemProduct) => <SourceTile key={p.product_id} image={p.image_url} title={productName(p)} meta={`${p.product_code} · ${p.active_price ?? '—'} د.ل`} onRemove={editable ? () => onRemove(p.product_id) : undefined} />)}
      {sources.map((a: Asset, i: number) => <SourceTile key={a.id} image={a.public_url} title={`صورة مرفوعة ${i + 1}`} meta="مرجع للتصميم" />)}
    </div></div>}
  </StepCard>;
}

function SourceTile({ image, title, meta, onRemove }: { image?: string | null; title: string; meta: string; onRemove?: () => void }) {
  return <div className="relative overflow-hidden rounded-xl border border-line bg-surface"><div className="aspect-[4/3] bg-surface2">{image ? <img src={image} alt="" className="h-full w-full object-contain" /> : <div className="grid h-full place-items-center text-faint"><ImageIcon /></div>}</div><div className="p-3"><b className="block truncate text-sm text-fg">{title}</b><span className="text-xs text-muted">{meta}</span></div>{onRemove && <button onClick={onRemove} aria-label="إزالة" className="absolute left-2 top-2 grid h-11 w-11 place-items-center rounded-full bg-bg/90 text-danger shadow"><Trash2 size={16} /></button>}</div>;
}

function PurposeStep({ detail, editable, patch, saveProducts }: any) {
  const { item, products } = detail;
  return <StepCard eyebrow="الخطوة 2 من 4" title="حدد الغرض وشكل الإخراج" intro="اختر القرارات المهمة فقط. النظام يضبط المقاس وتعليمات النموذج تلقائياً.">
    <ChoiceGroup label="الغرض" value={item.purpose} options={[{ value: 'general', title: 'عام', detail: 'محتوى منتج من دون تغيير سعر' }, { value: 'price_drop', title: 'تخفيض سعر', detail: 'أدخل السعر الجديد فقط؛ السعر القديم موثّق' }]} onChange={(purpose: string) => patch({ purpose })} disabled={!editable} />
    {item.purpose === 'price_drop' && <div className="mt-4 space-y-2 rounded-2xl border border-sand/40 bg-sand/8 p-4"><h3 className="text-sm font-bold text-fg">الأسعار الجديدة</h3>{products.map((p: ItemProduct) => <div key={p.product_id} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface p-3"><span className="min-w-0 flex-1 text-sm text-fg">{productName(p)} <small className="block text-muted">السعر الحالي الموثق: {p.active_price ?? 'غير متوفر'} د.ل</small></span><label className="text-xs text-muted">السعر الجديد<input type="number" inputMode="decimal" min="1" defaultValue={p.new_price ?? ''} onBlur={(e) => saveProducts(products.map((x: ItemProduct) => x.product_id === p.product_id ? { ...x, new_price: e.target.value ? Number(e.target.value) : null } : x))} className="input mt-1 w-32" /></label></div>)}</div>}
    {item.purpose === 'general' && products.length > 0 && <div className="mt-4 rounded-2xl border border-line p-4"><h3 className="mb-2 text-sm font-bold text-fg">إظهار السعر الحالي (اختياري)</h3>{products.map((p: ItemProduct) => <label key={p.product_id} className="flex min-h-12 items-center gap-3 border-b border-line last:border-0"><input type="checkbox" checked={p.show_price} onChange={(e) => saveProducts(products.map((x: ItemProduct) => x.product_id === p.product_id ? { ...x, show_price: e.target.checked } : x))} /><span className="flex-1 text-sm text-fg">{productName(p)}</span><span className="text-sm font-semibold text-navy">{p.active_price ?? '—'} د.ل</span></label>)}</div>}
    <ChoiceGroup label="المعالجة الإبداعية" value={item.creative_treatment} options={[{ value: 'ai_scene', title: 'مشهد Lifestyle بالذكاء الاصطناعي', detail: 'الافتراضي: تصوير تجاري واقعي يحافظ على المنتج' }, { value: 'use_original', title: 'استخدام الأصل', detail: 'تنسيق احترافي للصورة الأصلية مع النص والعلامة' }]} onChange={(creative_treatment: string) => patch({ creative_treatment })} disabled={!editable} />
    {products.length + detail.assets.filter((a: Asset) => a.asset_role === 'source').length > 1 && <ChoiceGroup label="عند وجود أكثر من مصدر" value={item.multi_product_layout} options={[{ value: 'carousel', title: 'Carousel', detail: 'صورة منفصلة لكل مصدر' }, { value: 'composition', title: 'تركيب واحد', detail: 'حتى 4 منتجات في مشهد واحد' }]} onChange={(multi_product_layout: string) => patch({ multi_product_layout })} disabled={!editable} />}
    <div className="mt-5 grid gap-3 sm:grid-cols-2"><MiniSelect label="المقاس" value={item.content_type} options={[['post','منشور 4:5'],['story','ستوري 9:16']]} change={(content_type: string) => patch({ content_type })} /><MultiButtons label="المنصات" values={item.platforms} change={(platforms: string[]) => patch({ platforms })} /></div>
  </StepCard>;
}

function CopyStep({ detail, editable, busy, phraseDirty, setPhraseDirty, patch, generate, generateCopy }: any) {
  const { item } = detail;
  const isPriceDrop = item.purpose === 'price_drop';
  const mode: string = item.image_text_mode ?? 'generated';
  const noPhrase = mode === 'none';
  // Price Drop keeps its promotional phrase (generate or write), never None.
  const MODES: { value: string; label: string; hint: string }[] = isPriceDrop
    ? [{ value: 'generated', label: 'توليد تلقائي', hint: 'الذكاء يكتب العبارة' }, { value: 'manual', label: 'كتابة يدوية', hint: 'اكتب العبارة بنفسك' }]
    : [{ value: 'generated', label: 'توليد تلقائي', hint: 'الذكاء يكتب العبارة' }, { value: 'manual', label: 'كتابة يدوية', hint: 'اكتب العبارة بنفسك' }, { value: 'none', label: 'بدون عبارة', hint: 'تصميم فاخر بدون نص ترويجي' }];
  const canGenerate = noPhrase || mode === 'generated' || Boolean(item.image_text?.trim());
  return <StepCard eyebrow="الخطوة 3 من 4" title="العبارة والكابشن" intro="اختر كيف تريد العبارة على الصورة. الكابشن مستقل ومتاح في كل الأوضاع. الضغط على «إنشاء التصميم» هو اعتماد العبارة/الوضع الحالي.">
    {/* mode selector — makes the No-phrase mode reachable for General content */}
    <div className="mb-4">
      <p className="mb-2 text-sm font-bold text-fg">العبارة على الصورة</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {MODES.map((mo) => <button key={mo.value} disabled={!editable || busy} onClick={() => mode !== mo.value && patch({ image_text_mode: mo.value })} className={`rounded-xl border p-3 text-start transition ${mode === mo.value ? 'border-navy bg-navy/[0.05] ring-1 ring-navy/15' : 'border-line hover:border-navy/30'}`}><b className="block text-sm text-fg">{mo.label}</b><small className="text-muted">{mo.hint}</small></button>)}
      </div>
    </div>

    {!noPhrase && <>
      <button onClick={generateCopy} disabled={!editable||busy} className="btn-secondary mb-3">{busy==='copy'?<Loader2 className="animate-spin" size={16}/>:<Sparkles size={16}/>} {mode === 'manual' ? 'اقتراح عبارة وكابشن' : 'توليد عبارة وكابشن'}</button>
      <label className="block text-sm font-bold text-fg">العبارة على الصورة<textarea key={item.image_text||'empty-phrase'} defaultValue={item.image_text ?? ''} onChange={() => setPhraseDirty(true)} onBlur={(e) => { setPhraseDirty(false); if (e.target.value !== (item.image_text ?? '')) patch({ image_text: e.target.value }); }} rows={3} maxLength={200} placeholder={mode === 'manual' ? 'اكتب العبارة التي تظهر على الصورة' : 'ولّد عبارة ثم عدّلها قبل إنشاء التصميم'} className="input mt-2 min-h-28 resize-y py-3 text-lg font-bold leading-8" /></label>
      {phraseDirty && <p className="mt-1 text-xs text-muted">سيتم حفظ العبارة عند الخروج من الحقل.</p>}
    </>}
    {noPhrase && <div className="mb-1"><button onClick={generateCopy} disabled={!editable||busy} className="btn-secondary mb-1">{busy==='copy'?<Loader2 className="animate-spin" size={16}/>:<Sparkles size={16}/>} توليد كابشن</button><p className="rounded-xl border border-line bg-surface2/50 p-3 text-xs text-muted">وضع «بدون عبارة»: تصميم فاخر بنفس الجودة بدون نص ترويجي على الصورة. الكابشن يبقى متاحاً بالأسفل.</p></div>}

    <label className="mt-5 block text-sm font-bold text-fg">الكابشن<textarea key={item.caption||'empty-caption'} defaultValue={item.caption ?? ''} onBlur={(e) => e.target.value !== (item.caption ?? '') && patch({ caption: e.target.value })} rows={7} maxLength={2200} placeholder="كابشن عربي كامل لفيسبوك وإنستغرام" className="input mt-2 min-h-44 resize-y py-3 leading-7" /></label>
    <div className="mt-6 rounded-2xl border border-navy/15 bg-navy/[0.035] p-4"><div className="flex items-start gap-3"><WandSparkles className="mt-1 shrink-0 text-navy" size={22} /><div><h3 className="font-bold text-fg">نتيجة واحدة بأعلى جودة</h3><p className="mt-1 text-sm leading-6 text-muted">Gemini 3 Pro Image بدقة 2K، مع فحص تلقائي للعناصر الظاهرة والنص والسعر والعلامة، وتصحيح واحد فقط عند اكتشاف خطأ واضح.</p></div></div><button disabled={!editable || busy || phraseDirty || !canGenerate} onClick={generate} className="btn-primary mt-4 w-full sm:w-auto">{busy === 'generate' ? <Loader2 className="animate-spin" size={17} /> : <Sparkles size={17} />} إنشاء التصميم</button></div>
  </StepCard>;
}

function PreviewStep({ detail, currentRun, selectedRun, selectedAssets, generating, busy, onSelect, onGenerate, warningAccepted, setWarningAccepted, scheduleLocal, setScheduleLocal, approve }: any) {
  const completed = detail.generations.filter((r: Generation) => r.status === 'completed' && r.config_revision === detail.item.config_revision);
  return <StepCard eyebrow="الخطوة 4 من 4" title="المعاينة والنشر" intro="اختر النسخة التي ستُنشر فعلياً، راجع الفحص، ثم انشر الآن أو جدوِل بتوقيت طرابلس.">
    {generating && <GenerationProgress run={currentRun} />}
    {!generating && selectedAssets.length > 0 && <PreviewPanel item={detail.item} assets={selectedAssets} run={selectedRun} mobile />}
    {!generating && selectedAssets.length === 0 && <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-surface2/40 p-8 text-center"><div><Images className="mx-auto mb-3 text-faint" size={34} /><h3 className="font-bold text-fg">لا توجد نسخة مختارة بعد</h3><p className="mt-1 text-sm text-muted">أنشئ التصميم أو اختر نسخة سابقة من الأسفل.</p><button onClick={onGenerate} disabled={busy} className="btn-primary mt-4"><Sparkles size={17} /> إنشاء الآن</button></div></div>}
    {completed.length > 0 && <div className="mt-5"><h3 className="mb-3 text-sm font-bold text-fg">سجل النسخ المحفوظة</h3><div className="grid gap-3 sm:grid-cols-2">{completed.map((run: Generation, i: number) => { const assets = detail.assets.filter((a: Asset) => a.generation_run_id === run.id); const selected = detail.item.selected_generation_run_id === run.id; return <button key={run.id} onClick={() => !selected && onSelect(run.id)} className={`overflow-hidden rounded-xl border text-start transition ${selected ? 'border-navy ring-2 ring-navy/10' : 'border-line hover:border-navy/30'}`}><div className="grid grid-cols-3 gap-px bg-line">{assets.slice(0,3).map((a: Asset) => <img key={a.id} src={a.public_url ?? ''} alt="" className="aspect-square w-full bg-surface2 object-cover" />)}</div><div className="flex items-center gap-2 p-3"><span className="flex-1"><b className="block text-sm text-fg">نسخة {completed.length - i}</b><small className="text-muted">{run.source_model || run.requested_model} · {run.attempt_count} محاولة</small></span>{selected ? <span className="badge-good"><Check size={12}/> مختارة</span> : busy === `select:${run.id}` ? <Loader2 className="animate-spin" size={16}/> : <span className="text-xs text-navy">اختيار</span>}</div></button>; })}</div></div>}
    {selectedRun && <QualitySummary run={selectedRun} />}
    {selectedRun?.quality_status === 'warning' && <label className="mt-4 flex min-h-14 items-start gap-3 rounded-xl border border-warning/30 bg-warning/8 p-3 text-sm text-fg"><input type="checkbox" checked={warningAccepted} onChange={(e) => setWarningAccepted(e.target.checked)} className="mt-1 h-5 w-5" /><span><b className="block">أقرّ أنني راجعت تحذير الجودة</b>لن يسمح النظام بالنشر قبل هذا التأكيد.</span></label>}
    {selectedRun && <div className="sticky bottom-[68px] z-20 -mx-5 mt-6 border-t border-line bg-surface/95 p-4 backdrop-blur lg:static lg:mx-0 lg:rounded-2xl lg:border"><div className="grid gap-3 sm:grid-cols-[auto_1fr_auto]"><button onClick={() => approve('now')} disabled={busy || (selectedRun.quality_status === 'warning' && !warningAccepted)} className="btn-primary min-h-12">{busy === 'now' ? <Loader2 className="animate-spin" size={17}/> : <Send size={17}/>} اعتماد ونشر الآن</button><input type="datetime-local" value={scheduleLocal} onChange={(e) => setScheduleLocal(e.target.value)} className="input min-h-12" dir="ltr"/><button onClick={() => approve('schedule')} disabled={busy || !scheduleLocal || (selectedRun.quality_status === 'warning' && !warningAccepted)} className="btn-secondary min-h-12"><CalendarClock size={17}/> جدولة بتوقيت طرابلس</button></div></div>}
  </StepCard>;
}

function GenerationProgress({ run }: { run?: Generation }) {
  const keys = ['queued','analyzing','creating','verifying_product','verifying_text','finished'];
  const index = Math.max(0, keys.indexOf(run?.stage ?? 'queued'));
  return <div className="rounded-2xl border border-navy/20 bg-navy/[0.035] p-5"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-full bg-navy text-white"><Loader2 className="animate-spin" size={20}/></span><div><h3 className="font-bold text-fg">{STAGES[run?.stage ?? 'queued']}</h3><p className="text-sm text-muted">يمكنك مغادرة الصفحة؛ العملية محفوظة وستستمر في الخلفية.</p></div></div><div className="mt-5 flex gap-1.5" aria-label="تقدم التوليد">{keys.map((k,i) => <span key={k} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${i <= index ? 'bg-navy' : 'bg-line'}`}/>)}</div></div>;
}

function PreviewPanel({ item, assets, run, mobile = false }: { item: any; assets: Asset[]; run?: Generation; mobile?: boolean }) {
  return <div className={`${mobile ? 'mt-4' : 'sticky top-24'} rounded-2xl border border-line bg-surface p-4 shadow-card`}><div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-semibold text-muted">معاينة {item.content_type === 'story' ? '9:16' : '4:5'}</p><h3 className="font-bold text-fg">ما سيتم نشره</h3></div>{run && <span className={run.quality_status === 'verified' ? 'badge-good' : run.quality_status === 'warning' ? 'badge-warn' : 'badge-muted'}>{run.quality_status === 'verified' ? 'تم الفحص' : run.quality_status === 'warning' ? 'تحذير' : 'قيد الفحص'}</span>}</div><div className={`mx-auto overflow-hidden rounded-xl bg-surface2 ${item.content_type === 'story' ? 'aspect-[9/16] max-h-[620px]' : 'aspect-[4/5]'}`}>{assets[0]?.public_url ? <img src={assets[0].public_url} alt="المعاينة النهائية" className="h-full w-full object-contain" /> : <div className="grid h-full place-items-center text-faint"><ImageIcon size={32}/></div>}</div>{assets.length > 1 && <div className="mt-2 flex gap-2 overflow-x-auto">{assets.map((a,i) => <img key={a.id} src={a.public_url ?? ''} alt={`صورة ${i+1}`} className="h-20 w-16 shrink-0 rounded-lg border border-line object-cover" />)}</div>}<p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-fg">{item.caption || 'بدون كابشن بعد'}</p></div>;
}

function QualitySummary({ run }: { run: Generation }) {
  const warns = warningList(run.warnings);
  return <div className={`mt-5 rounded-xl border p-4 ${run.quality_status === 'verified' ? 'border-success/25 bg-success/6' : 'border-warning/30 bg-warning/8'}`}><div className="flex items-center gap-2">{run.quality_status === 'verified' ? <CheckCircle2 className="text-success" size={19}/> : <CircleAlert className="text-warning" size={19}/>}<b className="text-sm text-fg">{run.quality_status === 'verified' ? 'اجتاز فحص العناصر الظاهرة والنص والسعر والعلامة' : 'اكتمل مع ملاحظة واضحة تحتاج مراجعتك'}</b></div>{warns.length > 0 && <ul className="mt-2 list-inside list-disc space-y-1 text-xs leading-5 text-muted">{warns.map((w,i) => <li key={i}>{w}</li>)}</ul>}<div className="mt-3 flex flex-wrap gap-3 text-xs text-muted"><span>النموذج: {run.source_model || run.requested_model || 'gemini-3-pro-image'}</span><span>مرات إنشاء الصورة: {run.attempt_count}</span>{run.finished_at && <span>الانتهاء: {new Date(run.finished_at).toLocaleString('ar-LY')}</span>}</div></div>;
}

function StepCard({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6"><p className="text-xs font-bold text-sand-dark">{eyebrow}</p><h2 className="mt-1 text-xl font-bold text-fg sm:text-2xl">{title}</h2><p className="mt-2 mb-6 max-w-2xl text-sm leading-6 text-muted">{intro}</p>{children}</section>; }
function ChoiceGroup({ label, value, options, onChange, disabled }: any) { return <fieldset className="mt-5 first:mt-0"><legend className="mb-2 text-sm font-bold text-fg">{label}</legend><div className="grid gap-3 sm:grid-cols-2">{options.map((o: any) => <button type="button" key={o.value} disabled={disabled} onClick={() => onChange(o.value)} className={`min-h-24 rounded-xl border p-4 text-start transition ${value === o.value ? 'border-navy bg-navy/[0.045] ring-2 ring-navy/8' : 'border-line hover:border-navy/25 hover:bg-surface2'}`}><span className="flex items-center gap-2"><span className={`grid h-5 w-5 place-items-center rounded-full border ${value === o.value ? 'border-navy bg-navy text-white' : 'border-line'}`}>{value === o.value && <Check size={12}/>}</span><b className="text-sm text-fg">{o.title}</b></span><span className="mt-2 block ps-7 text-xs leading-5 text-muted">{o.detail}</span></button>)}</div></fieldset>; }
function MiniSelect({ label, value, options, change }: any) { return <div><p className="mb-2 text-sm font-bold text-fg">{label}</p><div className="grid grid-cols-2 gap-2">{options.map(([v,l]: string[]) => <button key={v} onClick={() => change(v)} className={`min-h-12 rounded-xl border px-3 text-sm ${value === v ? 'border-navy bg-navy text-white' : 'border-line text-muted'}`}>{l}</button>)}</div></div>; }
function MultiButtons({ label, values, change }: any) { const toggle = (v: string) => { const next = values.includes(v) ? values.filter((x: string) => x !== v) : [...values,v]; if (next.length) change(next); }; return <div><p className="mb-2 text-sm font-bold text-fg">{label}</p><div className="grid grid-cols-2 gap-2">{[['facebook','فيسبوك'],['instagram','إنستغرام']].map(([v,l]) => <button key={v} onClick={() => toggle(v)} className={`min-h-12 rounded-xl border px-3 text-sm ${values.includes(v) ? 'border-navy bg-navy text-white' : 'border-line text-muted'}`}>{l}</button>)}</div></div>; }
function Status({ status }: { status: string }) { const labels: Record<string,string> = { draft:'مسودة',generating:'قيد التوليد',ready:'جاهز',approved:'معتمد',scheduled:'مجدول',publishing:'ينشر الآن',published:'منشور',partially_published:'منشور جزئياً',failed:'مشكلة',archived:'مؤرشف' }; return <span className={`rounded-full px-3 py-1 text-xs font-bold ${status === 'failed' ? 'bg-danger/10 text-danger' : status === 'published' ? 'bg-success/10 text-success' : 'bg-surface2 text-muted'}`}>{labels[status] ?? status}</span>; }
function EditorSkeleton() { return <div className="mx-auto max-w-6xl animate-pulse space-y-4"><div className="h-14 w-80 rounded-xl bg-surface2"/><div className="h-20 rounded-2xl bg-surface2"/><div className="h-[520px] rounded-2xl bg-surface2"/></div>; }

function PublicationMonitor({ rows, busy, retry }: { rows: Publication[]; busy: string | null; retry: (id: string) => void }) { return <section className="mt-5 rounded-2xl border border-line bg-surface p-5"><h2 className="mb-3 font-bold text-fg">النشر لكل منصة</h2><div className="space-y-2">{rows.map((p) => <div key={p.id} className="rounded-xl border border-line p-3"><div className="flex flex-wrap items-center gap-3"><b className="text-sm text-fg">{p.platform === 'facebook' ? 'فيسبوك' : 'إنستغرام'}</b><Status status={p.status}/><span className="text-xs text-muted">{p.format}</span>{p.permalink_url && <a href={p.permalink_url} target="_blank" rel="noreferrer" className="me-auto text-sm text-navy underline">فتح المنشور</a>}{['failed','uncertain','cancelled'].includes(p.status) && <button onClick={() => retry(p.id)} className="btn-secondary">{busy === `retry:${p.id}` ? <Loader2 className="animate-spin" size={15}/> : <RefreshCw size={15}/>} إعادة المحاولة</button>}</div>{p.last_error && <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-danger/6 p-3 font-sans text-xs leading-5 text-danger">{p.last_error}</pre>}</div>)}</div></section>; }
function CommentMonitor({ item, rows, patch }: { item: any; rows: CommentRow[]; patch: (b: Record<string, unknown>) => void }) { return <section className="mt-5 rounded-2xl border border-line bg-surface p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-bold text-fg"><MessageSquare size={18}/> التعليقات والردود</h2><label className="flex min-h-11 items-center gap-2 text-sm text-muted"><input type="checkbox" checked={item.comment_automation !== false} onChange={(e) => patch({ comment_automation: e.target.checked })}/> الرد الآلي مفعّل</label></div>{rows.length === 0 ? <p className="mt-3 text-sm text-muted">لا توجد تعليقات بعد.</p> : <div className="mt-3 space-y-2">{rows.map((c) => <article key={c.id} className="rounded-xl border border-line p-3"><div className="flex justify-between gap-2"><b className="text-sm text-fg">{c.author_name || 'مستخدم'}</b><span className="text-xs text-faint">{c.platform}</span></div><p className="mt-1 text-sm text-fg">{c.body}</p>{c.reply_text && <div className="mt-2 border-s-2 border-navy ps-3 text-xs leading-5 text-muted"><b>{c.reply_status === 'sent' ? 'تم الرد: ' : 'الرد: '}</b>{c.reply_text}{c.reply_error && <pre className="mt-1 whitespace-pre-wrap text-danger">{c.reply_error}</pre>}</div>}</article>)}</div>}</section>; }
