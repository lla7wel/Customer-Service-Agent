'use client';
/* eslint-disable @next/next/no-img-element -- operator review needs original remote catalog media */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ImageOff, Check, X, Hash, Barcode, Tag, Loader2, Languages, ChevronLeft, ChevronRight, Sparkles,
  RefreshCw, AlertTriangle, Clock, RotateCcw, HelpCircle, ScanSearch, CheckCheck, Upload,
} from 'lucide-react';
import { Card, EmptyState } from '@/components/ui';

type State = 'possible' | 'approved' | 'rejected' | 'no_match' | 'needs_review';
type Level = 'high' | 'medium' | 'low' | 'none';

interface Suggestion {
  scraper_product_id: string;
  source_name: string | null;
  image: string | null;
  image_count: number;
  confidence: number | null;
  level: Level;
  shared: string[];
  reason: string;
}
interface Row {
  id: string;
  suggestionId: string;
  state: State;
  name: string;
  english_name: string | null;
  arabic_name: string | null;
  libyan_display_name: string | null;
  product_code: string | null;
  barcode: string | null;
  category: string | null;
  search_keywords: string[];
  arabic_keywords: string[];
  price: number | null;
  suggestion: Suggestion | null;
}
interface Counts {
  possible: number;
  approved: number;
  rejected: number;
  no_match: number;
  needs_review: number;
  activeCsvMissingImages: number;
  scraperOnlyReviewRemaining: number;
}

const STATES: { key: State; en: string; ar: string; icon: any }[] = [
  { key: 'possible', en: 'Possible', ar: 'محتملة', icon: Sparkles },
  { key: 'approved', en: 'Approved', ar: 'مقبولة', icon: Check },
  { key: 'rejected', en: 'Rejected', ar: 'مرفوضة', icon: X },
  { key: 'no_match', en: 'No safe match', ar: 'لا تطابق آمن', icon: AlertTriangle },
  { key: 'needs_review', en: 'Needs review', ar: 'للمراجعة', icon: Clock },
];

function levelTone(level: Level) {
  if (level === 'high') return 'text-emerald-400';
  if (level === 'medium') return 'text-accent';
  if (level === 'low') return 'text-amber-400';
  return 'text-faint';
}
function levelLabel(level: Level, ar: boolean) {
  if (!ar) return level;
  return level === 'high' ? 'عالٍ' : level === 'medium' ? 'متوسط' : level === 'low' ? 'منخفض' : '—';
}

export default function CatalogMatch({ ar }: { ar: boolean }) {
  const [state, setState] = useState<State>('possible');
  const [confidence, setConfidence] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(18);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshBusy, setRefreshBusy] = useState<'dry' | 'apply' | null>(null);
  const [refreshResult, setRefreshResult] = useState<any>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ approved: number; skipped: number } | null>(null);
  const [showImgSearch, setShowImgSearch] = useState(false);

  const load = useCallback(async (s: State, conf: string, p: number) => {
    setLoading(true);
    try {
      const cq = s === 'possible' && conf !== 'all' ? `&confidence=${conf}` : '';
      const res = await fetch(`/api/catalog-match?state=${s}&page=${p}${cq}`, { cache: 'no-store' });
      const j = await res.json();
      setRows(j.rows ?? []);
      setTotal(j.total ?? 0);
      setPageSize(j.pageSize ?? 18);
      setCounts(j.counts ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(state, confidence, page); }, [state, confidence, page, load]);

  function switchState(s: State) {
    setState(s);
    setPage(0);
    if (s !== 'possible') setConfidence('all');
  }

  async function act(url: string, body: Record<string, unknown>, rowId: string) {
    setBusy(rowId);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) setRows((rs) => rs.filter((x) => x.id !== rowId));
      return res.ok;
    } finally {
      setBusy(null);
    }
  }

  const approve = (r: Row) =>
    r.suggestion && act('/api/catalog-match/approve', { csvProductId: r.id, scraperProductId: r.suggestion.scraper_product_id }, r.id);
  const reject = (r: Row) =>
    r.suggestion
      ? act('/api/catalog-match/reject', { csvProductId: r.id, scraperProductId: r.suggestion.scraper_product_id, reason: r.suggestion.reason }, r.id)
      : mark(r, 'no_match');
  const mark = (r: Row, s: State) => act('/api/catalog-match/mark', { csvProductId: r.id, state: s }, r.id);

  async function runRefresh(dryRun: boolean) {
    if (!dryRun && !window.confirm(ar ? 'إعادة حساب كل الاقتراحات؟ لن تُرفق أي صورة، فقط تُحدّث قائمة المراجعة.' : 'Recompute all suggestions? No image is attached — only the review list is updated.')) return;
    setRefreshBusy(dryRun ? 'dry' : 'apply');
    try {
      const res = await fetch('/api/catalog-match/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });
      const j = await res.json();
      setRefreshResult(j);
      if (!dryRun) await load(state, confidence, 0);
    } finally {
      setRefreshBusy(null);
    }
  }

  async function runBulkApprove() {
    // Safety: 'all' bulk-approving low-confidence is risky, so when no confidence
    // subfilter is chosen we restrict the bulk to HIGH confidence only.
    const conf = confidence === 'all' ? 'high' : confidence;
    if (!window.confirm(
      ar
        ? `قبول جماعي للمطابقات المحتملة بثقة «${levelLabel(conf, true)}»؟ يتم تخطّي أي تعارض تلقائيًا.`
        : `Bulk-approve "${conf}" confidence possible matches? Conflicts are skipped automatically.`,
    )) return;
    setBulkBusy(true); setBulkResult(null);
    try {
      const res = await fetch('/api/catalog-match/bulk-approve', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confidence: conf, limit: 200 }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) { setBulkResult({ approved: j.approved ?? 0, skipped: j.skipped ?? 0 }); await load(state, confidence, 0); }
      else setBulkResult({ approved: 0, skipped: 0 });
    } finally { setBulkBusy(false); }
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <section className="command-surface flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
            <ScanSearch size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold text-fg">{ar ? 'مركز مطابقة الصور' : 'Image match review center'}</p>
            <p className="text-xs text-muted">{ar ? 'اقبل المطابقات الواثقة واترك الحالات المشكوك فيها للمراجعة.' : 'Approve confident matches and isolate uncertain catalog cases.'}</p>
          </div>
        </div>
        <div className="relative flex flex-wrap gap-2 text-xs">
          <span className="chip bg-accent/12 text-accent ring-accent/25">{(counts?.possible ?? 0).toLocaleString()} {ar ? 'محتملة' : 'possible'}</span>
          <span className="chip bg-success/12 text-success ring-success/25">{(counts?.approved ?? 0).toLocaleString()} {ar ? 'مقبولة' : 'approved'}</span>
        </div>
      </section>
      {/* State tabs */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-surface/80 p-1.5 shadow-card backdrop-blur-md">
        {STATES.map((s) => (
          <button
            key={s.key}
            onClick={() => switchState(s.key)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
              state === s.key ? 'border-accent bg-accent/10 text-accent shadow-glow' : 'border-transparent bg-transparent text-muted hover:bg-surface2 hover:text-fg'
            }`}
          >
            <s.icon size={13} />
            {ar ? s.ar : s.en}
            {counts && <span className="ltr-nums opacity-70">{(counts[s.key] ?? 0).toLocaleString()}</span>}
          </button>
        ))}
      </div>

      {/* Toolbar: confidence subfilter (possible only) + refresh */}
      <div className="rounded-xl border border-line bg-surface/70 p-3 shadow-card backdrop-blur-md">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {state === 'possible' && (
            <div className="flex gap-1">
              {(['all', 'high', 'medium', 'low'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => { setConfidence(c); setPage(0); }}
                  className={`rounded-md border px-2.5 py-1 text-xs transition ${
                    confidence === c ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-surface text-muted hover:text-fg'
                  }`}
                >
                  {c === 'all' ? (ar ? 'الكل' : 'All') : levelLabel(c, ar)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowImgSearch((v) => !v)} className="btn-ghost" title={ar ? 'ابحث عن منتج بالصورة' : 'Find products by image'}>
            <ScanSearch size={15} className="text-accent" /> {ar ? 'بحث بالصورة' : 'Image search'}
          </button>
          {state === 'possible' && (
            <button onClick={runBulkApprove} disabled={bulkBusy || loading} className="btn-ghost" title={ar ? 'قبول جماعي للمطابقات عالية الثقة' : 'Bulk-approve high-confidence matches'}>
              {bulkBusy ? <Loader2 size={15} className="animate-spin" /> : <CheckCheck size={15} className="text-success" />}
              {ar ? 'قبول جماعي' : 'Bulk approve'}
            </button>
          )}
          <button onClick={() => runRefresh(true)} disabled={!!refreshBusy} className="btn-ghost">
            {refreshBusy === 'dry' ? <Loader2 size={15} className="animate-spin" /> : <HelpCircle size={15} />}
            {ar ? 'معاينة' : 'Preview'}
          </button>
          <button onClick={() => runRefresh(false)} disabled={!!refreshBusy} className="btn-primary">
            {refreshBusy === 'apply' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            {ar ? 'تحديث الاقتراحات' : 'Refresh suggestions'}
          </button>
        </div>
      </div>
      </div>

      {bulkResult && (
        <p className="text-xs text-muted">
          {ar ? `قبول جماعي: تمت الموافقة على ${bulkResult.approved} وتخطّي ${bulkResult.skipped}.` : `Bulk approve: ${bulkResult.approved} approved, ${bulkResult.skipped} skipped.`}
        </p>
      )}

      {showImgSearch && <CatalogImageSearch ar={ar} onClose={() => setShowImgSearch(false)} />}

      {/* Stats */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={ar ? 'CSV بلا صور' : 'CSV missing images'} value={counts?.activeCsvMissingImages ?? null} />
        <Stat label={ar ? 'محتملة' : 'Possible'} value={counts?.possible ?? null} />
        <Stat label={ar ? 'مقبولة' : 'Approved'} value={counts?.approved ?? null} />
        <Stat label={ar ? 'سكرابر للمراجعة' : 'Scraper review'} value={counts?.scraperOnlyReviewRemaining ?? null} />
      </div>

      {refreshResult && (
        <Card className="text-sm text-muted">
          {refreshResult.error ? (
            <p className="text-danger">{refreshResult.error}</p>
          ) : (
            <p>
              {ar
                ? `${refreshResult.dryRun ? 'معاينة: ' : 'تم: '} ${refreshResult.checked ?? 0} منتج مفحوص · ${refreshResult.possible ?? 0} محتملة (عالٍ ${refreshResult.byConfidence?.high ?? 0}، متوسط ${refreshResult.byConfidence?.medium ?? 0}، منخفض ${refreshResult.byConfidence?.low ?? 0}) · ${refreshResult.noMatch ?? 0} بلا تطابق · ${refreshResult.preserved ?? 0} محفوظة (قرار المشرف).`
                : `${refreshResult.dryRun ? 'Preview: ' : 'Done: '} ${refreshResult.checked ?? 0} checked · ${refreshResult.possible ?? 0} possible (high ${refreshResult.byConfidence?.high ?? 0}, medium ${refreshResult.byConfidence?.medium ?? 0}, low ${refreshResult.byConfidence?.low ?? 0}) · ${refreshResult.noMatch ?? 0} no-match · ${refreshResult.preserved ?? 0} preserved (admin decisions).`}
            </p>
          )}
        </Card>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> {ar ? 'جارٍ التحميل…' : 'Loading…'}</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={state === 'possible' ? Sparkles : Check}
          title={ar ? 'لا عناصر هنا' : 'Nothing here'}
          hint={state === 'possible'
            ? (ar ? 'اضغط «تحديث الاقتراحات» لإعادة الحساب.' : 'Press “Refresh suggestions” to recompute.')
            : (ar ? 'لا عناصر في هذه الحالة.' : 'No items in this state.')}
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id} className="tilt-card flex flex-col gap-3 sm:flex-row sm:items-center">
              {/* CSV product */}
              <div className="min-w-0 flex-1">
                <Link href={`/products/${r.id}`} className="text-sm font-medium text-fg hover:text-accent" dir="auto">{r.name}</Link>
                {(r.english_name || r.arabic_name) && (
                  <p className="mt-1 line-clamp-1 text-xs text-muted" dir="auto">
                    {[r.english_name, r.arabic_name].filter(Boolean).join(' · ')}
                  </p>
                )}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-faint">
                  <span className="flex items-center gap-1"><Hash size={11} />{r.product_code}</span>
                  {r.barcode && <span className="flex items-center gap-1"><Barcode size={11} />{r.barcode}</span>}
                  {r.category && <span className="flex items-center gap-1"><Tag size={11} />{r.category}</span>}
                </div>
                {[...r.search_keywords, ...r.arabic_keywords].length > 0 && (
                  <p className="mt-1 line-clamp-1 text-[10px] text-faint" dir="auto">
                    {[...r.search_keywords, ...r.arabic_keywords].slice(0, 8).join(' · ')}
                  </p>
                )}
              </div>

              {/* Suggestion + actions */}
              {r.suggestion ? (
                <div className="flex items-center gap-3 sm:w-[48%]">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface2">
                    {r.suggestion.image ? (
                      <img src={r.suggestion.image} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-faint"><ImageOff size={18} /></div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`flex items-center gap-1 text-xs font-medium ${levelTone(r.suggestion.level)}`}>
                      <Sparkles size={11} /> {r.suggestion.confidence != null ? `${r.suggestion.confidence}% ` : ''}{levelLabel(r.suggestion.level, ar)}
                    </p>
                    <p className="mt-0.5 line-clamp-1 flex items-center gap-1 text-xs text-faint" dir="auto" title={r.suggestion.source_name ?? ''}>
                      <Languages size={11} /> {r.suggestion.source_name}
                    </p>
                    {r.suggestion.reason && (
                      <p className="mt-0.5 line-clamp-1 text-[10px] text-faint" title={r.suggestion.reason}>{r.suggestion.reason}</p>
                    )}
                    <p className="mt-0.5 line-clamp-1 text-[10px] text-faint">
                      {(ar ? 'صور: ' : 'Images: ') + r.suggestion.image_count}
                      {r.suggestion.shared.length > 0 ? ` · ${r.suggestion.shared.join(' · ')}` : ''}
                    </p>
                  </div>
                  <RowActions r={r} state={state} ar={ar} busy={busy === r.id} approve={approve} reject={reject} mark={mark} />
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 text-xs text-faint sm:w-[48%]">
                  <span>{ar ? 'لا اقتراح' : 'No suggestion'}</span>
                  <RowActions r={r} state={state} ar={ar} busy={busy === r.id} approve={approve} reject={reject} mark={mark} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn-ghost disabled:opacity-40">
            <ChevronLeft size={16} className="rtl-flip" /> {ar ? 'السابق' : 'Prev'}
          </button>
          <span className="text-sm text-muted">{page + 1} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="btn-ghost disabled:opacity-40">
            {ar ? 'التالي' : 'Next'} <ChevronRight size={16} className="rtl-flip" />
          </button>
        </div>
      )}
    </div>
  );
}

function RowActions({
  r, state, ar, busy, approve, reject, mark,
}: {
  r: Row; state: State; ar: boolean; busy: boolean;
  approve: (r: Row) => void; reject: (r: Row) => void; mark: (r: Row, s: State) => void;
}) {
  const spin = busy ? <Loader2 size={15} className="animate-spin" /> : null;
  if (state === 'approved') {
    return <Link href={`/products/${r.id}`} className="btn-ghost px-2.5 text-xs">{ar ? 'عرض' : 'View'}</Link>;
  }
  // For rejected / no_match: offer reopen back to possible.
  if (state === 'rejected' || state === 'no_match') {
    return (
      <button onClick={() => mark(r, 'possible')} disabled={busy} className="btn-ghost px-2.5" title={ar ? 'إعادة فتح' : 'Reopen'}>
        {spin ?? <RotateCcw size={15} />}
      </button>
    );
  }
  // possible + needs_review: full action set.
  return (
    <div className="flex shrink-0 gap-1.5">
      {r.suggestion && (
        <button onClick={() => approve(r)} disabled={busy} className="btn-primary px-2.5" title={ar ? 'موافقة' : 'Approve'}>
          {spin ?? <Check size={15} />}
        </button>
      )}
      {r.suggestion && (
        <button onClick={() => reject(r)} disabled={busy} className="btn-ghost px-2.5" title={ar ? 'رفض' : 'Reject'}>
          {spin ?? <X size={15} />}
        </button>
      )}
      {state !== 'needs_review' && (
        <button onClick={() => mark(r, 'needs_review')} disabled={busy} className="btn-ghost px-2.5" title={ar ? 'للمراجعة لاحقاً' : 'Needs review'}>
          {spin ?? <Clock size={15} />}
        </button>
      )}
      <button onClick={() => mark(r, 'no_match')} disabled={busy} className="btn-ghost px-2.5" title={ar ? 'لا تطابق آمن' : 'No safe match'}>
        {spin ?? <AlertTriangle size={15} />}
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-card">
      <p className="text-[10px] uppercase text-faint">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-fg">{value == null ? '-' : value.toLocaleString()}</p>
    </div>
  );
}

interface ImgCand {
  id: string; product_code: string | null; barcode?: string | null; name: string;
  price: number | null; image: string | null; confidence?: number; reason?: string | null;
}
/** Upload an image → find matching CATALOG products via the canonical resolver. */
function CatalogImageSearch({ ar, onClose }: { ar: boolean; onClose: () => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cands, setCands] = useState<ImgCand[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true); setErr(null); setCands(null);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file);
      });
      setPreview(dataUrl);
      const res = await fetch('/api/catalog-match/image-search', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: { data: dataUrl, mime: file.type }, limit: 8 }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 503) { setErr((ar ? 'غير مربوط: ' : 'Not connected: ') + (j?.missing?.join(', ') || 'GEMINI_API_KEY')); return; }
      if (!res.ok) { setErr(j?.timeout ? (ar ? 'انتهت المهلة — جرّب صورة أوضح' : 'Timed out — try a clearer image') : (j?.error || (ar ? 'فشل البحث' : 'Search failed'))); return; }
      setCands((j.candidates ?? []) as ImgCand[]);
    } catch { setErr(ar ? 'تعذّر قراءة الصورة' : 'Could not read image'); }
    finally { setBusy(false); }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <ScanSearch size={15} className="text-accent" /> {ar ? 'بحث عن منتج بالصورة' : 'Find products by image'}
        </span>
        <button onClick={onClose} className="btn-ghost h-8 w-8 p-0"><X size={15} /></button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-ghost cursor-pointer">
          <Upload size={15} /> {ar ? 'رفع صورة' : 'Upload image'}
          <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ''; }} />
        </label>
        {preview && <img src={preview} alt="" className="h-16 w-16 rounded-lg border border-line object-cover" />}
        {busy && <span className="flex items-center gap-1.5 text-xs text-muted"><Loader2 size={14} className="animate-spin" /> {ar ? 'جاري المطابقة…' : 'Matching…'}</span>}
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
      {cands && (
        cands.length === 0 ? (
          <p className="py-3 text-center text-xs text-faint">{ar ? 'لا يوجد تطابق واضح.' : 'No clear match.'}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {cands.map((c) => (
              <div key={c.id} className="flex min-w-0 items-start gap-3 rounded-lg border border-line bg-surface p-2.5">
                <span className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-line bg-surface2">
                  {c.image ? <img src={c.image} alt="" className="h-full w-full object-cover" /> : <ImageOff size={16} className="m-auto mt-5 text-faint" />}
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/products/${c.id}`} className="block wrap-break-word text-sm font-semibold leading-snug text-fg hover:text-accent" dir="auto">{c.name}</Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
                    {c.product_code && <span className="font-mono">{c.product_code}</span>}
                    {c.barcode && <span className="font-mono">{c.barcode}</span>}
                    <span className="ltr-nums text-success">{c.price != null ? `${c.price} د.ل` : (ar ? 'بدون سعر' : 'no price')}</span>
                    {typeof c.confidence === 'number' && <span className="rounded-sm bg-surface2 px-1.5 py-0.5">{Math.round(c.confidence * 100)}%</span>}
                  </div>
                  {c.reason && <p className="mt-1 line-clamp-2 text-[10px] text-faint" title={c.reason}>{c.reason}</p>}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </Card>
  );
}
