'use client';
/* eslint-disable @next/next/no-img-element -- product/content media come from our own media host */

/**
 * Content Studio editor — the full production workflow on one screen,
 * Arabic-RTL and phone-first:
 *
 *   1) اختر منتجات و/أو ارفع صور   2) اختر النمط والغرض
 *   3) العبارة والسعر               4) الكابشن المشترك
 *   5) توليد ومعاينة (ما تراه هو ما يُنشر)   6) اعتماد فوري أو جدولة بتوقيت طرابلس
 *
 * Publication states are shown truthfully per platform, with retry for the
 * failed platform only. Comments and their automated replies live here too.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, Search, Trash2, Upload, Sparkles, CalendarClock, Send, RefreshCw,
  MessageSquare, CircleCheck, CircleAlert, Archive,
} from 'lucide-react';

interface ItemProduct {
  row_id: string; product_id: string; new_price: number | null; show_price: boolean; position: number;
  product_code: string; libyan_display_name: string | null; arabic_name: string | null; english_name: string | null;
  active_price: number | null; base_price: number | null; image_url: string | null;
}
interface Asset { id: string; kind: string; public_url: string | null; position: number; product_id: string | null }
interface Publication {
  id: string; platform: string; format: string; status: string; provider_post_id: string | null;
  permalink_url: string | null; last_error: string | null; published_at: string | null;
}
interface CommentRow {
  id: string; author_name: string | null; body: string | null; decision: string | null; decision_reason: string | null;
  reply_text: string | null; reply_status: string | null; reply_error: string | null; platform: string; commented_at: string | null;
}
interface Detail {
  item: any; products: ItemProduct[]; assets: Asset[]; publications: Publication[]; comments: CommentRow[];
}

const pname = (p: ItemProduct) => p.libyan_display_name || p.arabic_name || p.english_name || p.product_code;

export default function ContentEditor({ contentId }: { contentId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scheduleLocal, setScheduleLocal] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/content/${contentId}`, { cache: 'no-store' });
    if (res.ok) setDetail(await res.json());
  }, [contentId]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 8000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  const item = detail?.item;
  const editable = item && ['draft', 'generating', 'ready', 'failed'].includes(item.status);
  const isPriceDrop = item?.purpose === 'price_drop';

  const patch = async (body: Record<string, unknown>, label = 'save') => {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(`/api/content/${contentId}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || 'failed');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'حدث خطأ');
    } finally {
      setBusy(null);
    }
  };

  const saveProducts = async (products: ItemProduct[]) =>
    patch({
      products: products.map((p) => ({ product_id: p.product_id, new_price: p.new_price, show_price: p.show_price })),
    }, 'products');

  const runSearch = async (q: string) => {
    setSearchQ(q);
    if (q.trim().length < 2) { setSearchResults([]); return; }
    const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`);
    if (res.ok) {
      const data = await res.json();
      setSearchResults((data.rows ?? []).slice(0, 8));
    }
  };

  const addProduct = async (p: any) => {
    if (!detail) return;
    if (detail.products.some((x) => x.product_id === p.id)) return;
    setSearchResults([]);
    setSearchQ('');
    await saveProducts([...detail.products, {
      row_id: '', product_id: p.id, new_price: null, show_price: false, position: detail.products.length,
      product_code: p.product_code ?? '', libyan_display_name: p.name ?? null, arabic_name: null,
      english_name: null, active_price: p.price ?? null, base_price: null, image_url: p.image ?? null,
    }]);
  };

  const upload = async (file: File) => {
    setBusy('upload');
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/content/${contentId}/upload`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || 'upload failed');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'فشل الرفع');
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    setBusy('generate');
    setError(null);
    try {
      const res = await fetch(`/api/content/${contentId}/generate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error((data?.problems ?? []).join('، ') || data?.error || 'failed');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'فشل التوليد');
    } finally {
      setBusy(null);
    }
  };

  const approve = async (when: 'now' | 'schedule') => {
    setBusy(when);
    setError(null);
    try {
      const res = await fetch(`/api/content/${contentId}/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(when === 'now' ? { when } : { when, local: scheduleLocal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || 'failed');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'فشل الاعتماد');
    } finally {
      setBusy(null);
    }
  };

  const retryPublication = async (pubId: string) => {
    setBusy(`retry:${pubId}`);
    await fetch(`/api/content/${contentId}/publications/${pubId}/retry`, { method: 'POST' });
    await load();
    setBusy(null);
  };

  if (!detail || !item) {
    return <div className="flex h-64 items-center justify-center text-muted"><Loader2 className="animate-spin" /></div>;
  }

  const statusChip = (s: string) => {
    const map: Record<string, { ar: string; cls: string }> = {
      draft: { ar: 'مسودة', cls: 'bg-surface2 text-muted' },
      generating: { ar: 'قيد التجهيز', cls: 'bg-accent/10 text-accent' },
      ready: { ar: 'جاهز للاعتماد', cls: 'bg-accent/10 text-accent' },
      approved: { ar: 'معتمد', cls: 'bg-accent/10 text-accent' },
      scheduled: { ar: 'مجدول', cls: 'bg-accent/10 text-accent' },
      publishing: { ar: 'ينشر الآن…', cls: 'bg-accent/10 text-accent' },
      published: { ar: 'منشور ✓', cls: 'bg-success/15 text-success' },
      partially_published: { ar: 'منشور جزئياً', cls: 'bg-warning/15 text-warning' },
      failed: { ar: 'فشل النشر', cls: 'bg-danger/15 text-danger' },
      archived: { ar: 'مؤرشف', cls: 'bg-surface2 text-muted' },
    };
    const m = map[s] ?? { ar: s, cls: 'bg-surface2 text-muted' };
    return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${m.cls}`}>{m.ar}</span>;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-24">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <input
            defaultValue={item.title ?? ''}
            placeholder="عنوان داخلي للمحتوى…"
            onBlur={(e) => { if (e.target.value !== (item.title ?? '')) patch({ title: e.target.value }); }}
            disabled={!editable}
            className="min-h-11 w-64 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-fg outline-none focus:border-accent/50"
            dir="auto"
          />
          {statusChip(item.status)}
        </div>
        <div className="flex items-center gap-2">
          {item.status !== 'archived' && (
            <button
              onClick={() => patch({ archive: true }, 'archive').then(() => router.push('/content-studio'))}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-3 text-sm text-muted transition hover:bg-surface2"
            >
              <Archive size={15} /> أرشفة
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
      {item.last_error && item.status === 'failed' && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{item.last_error}</div>
      )}

      {/* 1+2: configuration */}
      {editable && (
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Selector
              label="النوع"
              value={item.content_type}
              options={[{ v: 'post', l: '🖼️ منشور' }, { v: 'story', l: '📱 ستوري (9:16)' }]}
              onChange={(v) => patch({ content_type: v })}
            />
            <MultiSelector
              label="المنصات"
              values={item.platforms ?? []}
              options={[{ v: 'facebook', l: 'فيسبوك' }, { v: 'instagram', l: 'إنستغرام' }]}
              onChange={(vals) => patch({ platforms: vals })}
            />
            <Selector
              label="الغرض"
              value={item.purpose}
              options={[{ v: 'general', l: 'محتوى عام' }, { v: 'price_drop', l: '🔻 تخفيض سعر' }]}
              onChange={(v) => patch({ purpose: v })}
            />
            <Selector
              label="شكل الإخراج"
              value={item.output_mode}
              options={[
                { v: 'original', l: 'الصور الأصلية' },
                { v: 'carousel', l: 'صورة لكل منتج' },
                { v: 'combined', l: 'صورة مجمّعة' },
              ]}
              onChange={(v) => patch({ output_mode: v })}
            />
          </div>
        </section>
      )}

      {/* 3: products */}
      <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
        <h3 className="mb-3 text-sm font-bold text-fg">المنتجات المختارة</h3>
        {editable && (
          <div className="relative mb-3">
            <div className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface2 px-3">
              <Search size={15} className="shrink-0 text-muted" />
              <input
                value={searchQ}
                onChange={(e) => runSearch(e.target.value)}
                placeholder="ابحث بالاسم أو الكود أو الباركود…"
                className="min-h-11 w-full bg-transparent text-sm text-fg outline-none"
                dir="auto"
              />
            </div>
            {searchResults.length > 0 && (
              <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface shadow-card">
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addProduct(p)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-start transition hover:bg-surface2"
                  >
                    {p.image ? <img src={p.image} alt="" className="h-9 w-9 rounded-lg object-cover" /> : <span className="h-9 w-9 rounded-lg bg-surface2" />}
                    <span className="min-w-0 flex-1 truncate text-sm text-fg" dir="auto">{p.name}</span>
                    {p.price != null && <span className="shrink-0 text-xs font-semibold text-accent">{p.price} د.ل</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {detail.products.length === 0 ? (
          <p className="text-sm text-muted">لم تُختر منتجات بعد{isPriceDrop ? ' — التخفيض يتطلب منتجات.' : '.'}</p>
        ) : (
          <ul className="space-y-2">
            {detail.products.map((p) => (
              <li key={p.product_id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface2/50 p-2.5">
                {p.image_url ? <img src={p.image_url} alt="" className="h-11 w-11 rounded-lg object-cover" /> : <span className="h-11 w-11 rounded-lg bg-surface2" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg" dir="auto">{pname(p)}</p>
                  <p className="text-xs text-muted">
                    {p.active_price != null ? `السعر الحالي: ${p.active_price} د.ل` : 'بدون سعر'}
                  </p>
                </div>
                {isPriceDrop ? (
                  <label className="flex items-center gap-2 text-xs text-muted">
                    السعر الجديد
                    <input
                      type="number"
                      inputMode="decimal"
                      min={1}
                      defaultValue={p.new_price ?? ''}
                      disabled={!editable}
                      onBlur={(e) => {
                        const v = e.target.value ? Number(e.target.value) : null;
                        if (v !== p.new_price) {
                          saveProducts(detail.products.map((x) => (x.product_id === p.product_id ? { ...x, new_price: v } : x)));
                        }
                      }}
                      className="min-h-11 w-24 rounded-lg border border-line bg-surface px-2 text-sm font-semibold text-fg outline-none focus:border-accent/50"
                      dir="ltr"
                    />
                  </label>
                ) : (
                  <label className="flex min-h-11 items-center gap-1.5 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={p.show_price}
                      disabled={!editable}
                      onChange={(e) => saveProducts(detail.products.map((x) => (x.product_id === p.product_id ? { ...x, show_price: e.target.checked } : x)))}
                      className="h-4 w-4 accent-accent"
                    />
                    إظهار السعر
                  </label>
                )}
                {editable && (
                  <button
                    onClick={() => saveProducts(detail.products.filter((x) => x.product_id !== p.product_id))}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted transition hover:bg-danger/10 hover:text-danger"
                    aria-label="حذف المنتج"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {isPriceDrop && (
          <label className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <CalendarClock size={14} />
            نهاية العرض (اختياري — يرجّع السعر تلقائياً)
            <input
              type="datetime-local"
              defaultValue={item.promotion_ends_at ? String(item.promotion_ends_at).slice(0, 16) : ''}
              disabled={!editable}
              onBlur={(e) => patch({ promotion_ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
              className="min-h-11 rounded-lg border border-line bg-surface px-2 text-sm text-fg outline-none focus:border-accent/50"
              dir="ltr"
            />
          </label>
        )}
      </section>

      {/* 4: text */}
      <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
        <h3 className="mb-3 text-sm font-bold text-fg">النص على الصورة</h3>
        <div className="mb-3 flex flex-wrap gap-2">
          {[
            { v: 'generated', l: '✨ توليد عبارة' },
            { v: 'manual', l: '✍️ كتابة يدوية' },
            { v: 'none', l: 'بدون نص' },
          ].map((o) => (
            <button
              key={o.v}
              disabled={!editable}
              onClick={() => patch({ image_text_mode: o.v })}
              className={`min-h-11 rounded-lg border px-3 text-sm font-medium transition ${
                item.image_text_mode === o.v ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-muted hover:bg-surface2'
              }`}
            >
              {o.l}
            </button>
          ))}
        </div>
        {item.image_text_mode !== 'none' && (
          <input
            defaultValue={item.image_text ?? ''}
            placeholder={item.image_text_mode === 'generated' ? 'ستظهر العبارة المولّدة هنا — عدّلها كما تحب' : 'اكتب العبارة…'}
            disabled={!editable}
            onBlur={(e) => { if (e.target.value !== (item.image_text ?? '')) patch({ image_text: e.target.value }); }}
            className="min-h-11 w-full rounded-xl border border-line bg-surface2 px-3 text-sm text-fg outline-none focus:border-accent/50"
            dir="rtl"
          />
        )}
        <h3 className="mb-2 mt-4 text-sm font-bold text-fg">الكابشن (نفس النص لفيسبوك وإنستغرام)</h3>
        <textarea
          defaultValue={item.caption ?? ''}
          placeholder="يُقترح كابشن تلقائياً عند التوليد — عدّله بحرية…"
          disabled={!editable}
          onBlur={(e) => { if (e.target.value !== (item.caption ?? '')) patch({ caption: e.target.value }); }}
          rows={4}
          className="w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-sm leading-relaxed text-fg outline-none focus:border-accent/50"
          dir="rtl"
        />
      </section>

      {/* 5: assets + generate */}
      <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-fg">المعاينة — ما تراه هو ما يُنشر</h3>
          {editable && (
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy !== null}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line px-3 text-sm text-muted transition hover:bg-surface2"
              >
                {busy === 'upload' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} رفع صورة
              </button>
              <button
                onClick={generate}
                disabled={busy !== null}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-black shadow-glow transition hover:brightness-110 disabled:opacity-60"
              >
                {busy === 'generate' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                توليد التصاميم
              </button>
            </div>
          )}
        </div>
        {detail.assets.length === 0 ? (
          <p className="text-sm text-muted">ارفع صوراً أو اختر منتجات ثم اضغط «توليد التصاميم».</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {detail.assets.map((a) => (
              <figure key={a.id} className="overflow-hidden rounded-xl border border-line bg-surface2">
                {a.public_url ? (
                  <img src={a.public_url} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                ) : (
                  <div className="aspect-square w-full" />
                )}
                <figcaption className="px-2 py-1 text-center text-[10px] text-faint">
                  {a.kind === 'uploaded' ? 'مرفوعة' : 'مُركّبة'}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      {/* 6: approve / schedule */}
      {['ready', 'failed', 'partially_published'].includes(item.status) && (
        <section className="rounded-2xl border border-accent/30 bg-accent/5 p-4 shadow-card">
          <h3 className="mb-3 text-sm font-bold text-fg">الاعتماد — الخطوة النهائية</h3>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              onClick={() => approve('now')}
              disabled={busy !== null}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-bold text-black shadow-glow transition hover:brightness-110 disabled:opacity-60"
            >
              {busy === 'now' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              اعتماد ونشر الآن
            </button>
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <input
                type="datetime-local"
                value={scheduleLocal}
                onChange={(e) => setScheduleLocal(e.target.value)}
                className="min-h-12 rounded-xl border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-accent/50"
                dir="ltr"
              />
              <button
                onClick={() => approve('schedule')}
                disabled={busy !== null || !scheduleLocal}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-accent/40 px-4 text-sm font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-50"
              >
                {busy === 'schedule' ? <Loader2 size={15} className="animate-spin" /> : <CalendarClock size={15} />}
                جدولة (توقيت طرابلس)
              </button>
            </div>
          </div>
          {isPriceDrop && (
            <p className="mt-2 text-xs text-muted">
              🔒 السعر الجديد يُفعَّل فقط عندما تنجح أول منصة في النشر — النشر الفاشل لا يغيّر أي سعر.
            </p>
          )}
        </section>
      )}

      {/* publications */}
      {detail.publications.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <h3 className="mb-3 text-sm font-bold text-fg">حالة النشر لكل منصة</h3>
          <ul className="space-y-2">
            {detail.publications.map((pub) => (
              <li key={pub.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface2/50 p-3">
                <span className="text-sm font-semibold text-fg">{pub.platform === 'facebook' ? 'فيسبوك' : 'إنستغرام'}</span>
                <span className="text-xs text-muted">{pub.format}</span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  pub.status === 'published' ? 'bg-success/15 text-success'
                  : pub.status === 'failed' ? 'bg-danger/15 text-danger'
                  : 'bg-accent/10 text-accent'
                }`}>
                  {pub.status === 'published' ? <CircleCheck size={12} /> : pub.status === 'failed' ? <CircleAlert size={12} /> : <Loader2 size={12} className="animate-spin" />}
                  {pub.status === 'published' ? 'منشور' : pub.status === 'failed' ? 'فشل' : pub.status === 'publishing' ? 'ينشر…' : pub.status}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-danger">{pub.last_error ?? ''}</span>
                {pub.permalink_url && (
                  <a href={pub.permalink_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent hover:underline">فتح المنشور</a>
                )}
                {['failed', 'uncertain', 'cancelled'].includes(pub.status) && (
                  <button
                    onClick={() => retryPublication(pub.id)}
                    disabled={busy !== null}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-fg transition hover:bg-surface2"
                  >
                    {busy === `retry:${pub.id}` ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    إعادة محاولة هذه المنصة فقط
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* comments */}
      {['published', 'partially_published'].includes(item.status) && (
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-fg">
              <MessageSquare size={15} /> التعليقات والردود الآلية
            </h3>
            <label className="flex min-h-11 items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={item.comment_automation !== false}
                onChange={(e) => patch({ comment_automation: e.target.checked })}
                className="h-4 w-4 accent-accent"
              />
              الرد الآلي مفعّل لهذا المحتوى
            </label>
          </div>
          {detail.comments.length === 0 ? (
            <p className="text-sm text-muted">لا توجد تعليقات بعد — تُفحص التعليقات تلقائياً كل دقيقتين.</p>
          ) : (
            <ul className="space-y-2">
              {detail.comments.map((c) => (
                <li key={c.id} className="rounded-xl border border-line bg-surface2/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-fg" dir="auto">{c.author_name ?? 'مستخدم'}</p>
                    <span className="text-[10px] text-faint">{c.platform === 'facebook' ? 'فيسبوك' : 'إنستغرام'}</span>
                  </div>
                  <p className="mt-1 text-sm text-fg" dir="auto">{c.body ?? ''}</p>
                  {c.reply_text && (
                    <div className={`mt-2 rounded-lg border-s-2 ps-3 text-xs ${c.reply_status === 'sent' ? 'border-success text-muted' : c.reply_status === 'failed' ? 'border-danger text-danger' : 'border-line text-muted'}`} dir="auto">
                      <span className="font-semibold">{c.reply_status === 'sent' ? 'رددنا: ' : c.reply_status === 'failed' ? `فشل الرد (${c.reply_error ?? ''}): ` : 'رد معلّق: '}</span>
                      {c.reply_text}
                    </div>
                  )}
                  {c.decision === 'human_attention' && (
                    <p className="mt-1 text-[11px] font-semibold text-warning">⚠ يحتاج متابعة بشرية — {c.decision_reason}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Selector({ label, value, options, onChange }: {
  label: string; value: string; options: { v: string; l: string }[]; onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`min-h-11 rounded-lg border px-3 text-sm font-medium transition ${
              value === o.v ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-muted hover:bg-surface2'
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function MultiSelector({ label, values, options, onChange }: {
  label: string; values: string[]; options: { v: string; l: string }[]; onChange: (v: string[]) => void;
}) {
  const toggle = (v: string) => {
    const next = values.includes(v) ? values.filter((x) => x !== v) : [...values, v];
    if (next.length) onChange(next);
  };
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.v}
            onClick={() => toggle(o.v)}
            className={`min-h-11 rounded-lg border px-3 text-sm font-medium transition ${
              values.includes(o.v) ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-muted hover:bg-surface2'
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}
