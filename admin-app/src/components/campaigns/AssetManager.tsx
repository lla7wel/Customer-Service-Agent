'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, ImagePlus, Trash2, Search, Plus, X, Images, Wand2, Check, RefreshCw } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import type { Locale } from '@/lib/i18n/config';

interface Asset {
  id: string;
  kind: string;
  public_url: string | null;
  approved?: boolean;
  source_asset_id?: string | null;
}
interface FoundProduct {
  id: string;
  name: string;
  price: number | null;
  image: string | null;
}

export default function AssetManager({
  campaignId,
  assets,
  locale,
}: {
  campaignId: string;
  assets: Asset[];
  locale: Locale;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: 'ok' | 'err' | 'info'; t: string } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');

  const sourceAssets = assets.filter((a) => a.kind !== 'ai_edited_image' && a.public_url);
  const editedAssets = assets.filter((a) => a.kind === 'ai_edited_image');
  const approvedAssets = editedAssets.filter((a) => a.approved);

  async function campaignAction(payload: Record<string, unknown>): Promise<{ ok: boolean; data: any; status: number }> {
    const res = await fetch(`/api/campaigns/${campaignId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
  }

  async function generateEdits() {
    if (!editPrompt.trim()) { setMsg({ k: 'info', t: ar ? 'اكتب وصف التعديل أولاً' : 'Enter an edit prompt first' }); return; }
    setBusy(true); setMsg({ k: 'info', t: ar ? 'جاري توليد الصور… قد يأخذ حتى دقيقة' : 'Generating images… this can take up to a minute' });
    const { ok, data, status } = await campaignAction({ action: 'generate_edits', prompt: editPrompt });
    setBusy(false);
    if (ok && (data.created?.length ?? 0) > 0) {
      const failed = data.errors?.length ? (ar ? ` · فشل ${data.errors.length}` : ` · ${data.errors.length} failed`) : '';
      const modelNote = data.model ? (ar ? ` · النموذج: ${data.model}` : ` · model: ${data.model}`) : '';
      const fbNote = data.fallbackUsed
        ? (ar ? ` ⚠︎ نموذج احتياطي (الأساسي ${data.requestedModel} مشغول)` : ` ⚠︎ fallback used (primary ${data.requestedModel} busy)`)
        : '';
      const moreNote = data.remaining > 0
        ? (ar ? ` · باقي ${data.remaining} صورة — اضغط توليد مرة أخرى` : ` · ${data.remaining} more left — click generate again`)
        : '';
      setMsg({ k: data.fallbackUsed || data.remaining > 0 ? 'info' : (data.errors?.length ? 'info' : 'ok'), t: (ar ? `تم توليد ${data.created.length} صورة معدّلة${failed}` : `Generated ${data.created.length} edited image(s)${failed}`) + modelNote + fbNote + moreNote });
      router.refresh();
    } else if (ok) {
      setMsg({ k: 'err', t: ar ? 'لم يتم توليد أي صورة. تأكد من إعداد نموذج الصور.' : 'No edited images were generated. Check the image model setup.' });
    }
    else if (status === 503) setMsg({ k: 'info', t: (ar ? 'الذكاء غير مربوط: ' : 'AI not connected: ') + (data?.missing?.join(', ') || 'GEMINI_API_KEY') });
    else {
      // Surface real errors (timeout / model failure / hint) instead of "Failed".
      const isTimeout = /timed out|504|timeout/i.test(JSON.stringify(data || {}));
      const base = data?.detail || data?.hint || data?.error || (ar ? 'فشل التوليد' : 'Generation failed');
      setMsg({ k: 'err', t: isTimeout ? (ar ? 'انتهت المهلة — جرّب مرة أخرى (النموذج مشغول)' : 'Timed out — try again (model busy)') : base });
    }
  }

  async function approve(assetId: string) { setBusy(true); const { ok } = await campaignAction({ action: 'approve_asset', assetId }); setBusy(false); if (ok) router.refresh(); }
  async function regenerate(assetId: string) {
    setBusy(true); setMsg(null);
    const { ok, data } = await campaignAction({ action: 'regenerate_edit', assetId, prompt: editPrompt || undefined });
    setBusy(false);
    if (ok) router.refresh(); else setMsg({ k: 'err', t: data?.error || 'Failed' });
  }
  async function reject(assetId: string) { setBusy(true); const { ok } = await campaignAction({ action: 'reject_asset', assetId }); setBusy(false); if (ok) router.refresh(); }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('files', f));
    const res = await fetch(`/api/campaigns/${campaignId}/assets`, { method: 'POST', body: fd });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMsg({ k: 'ok', t: ar ? `تم رفع ${d.created?.length ?? 0} صورة` : `Uploaded ${d.created?.length ?? 0}` });
      router.refresh();
    } else if (res.status === 503) {
      setMsg({ k: 'info', t: (ar ? 'غير مربوط: ' : 'Not connected: ') + (d?.missing?.join(', ') || d?.error) });
    } else {
      setMsg({ k: 'err', t: d?.error || 'Upload failed' });
    }
  }

  async function attachProducts(ids: string[]) {
    setBusy(true);
    const res = await fetch(`/api/campaigns/${campaignId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'attach_products', productIds: ids }),
    });
    setBusy(false);
    setShowPicker(false);
    if (res.ok) router.refresh();
  }

  async function remove(assetId: string) {
    await fetch(`/api/campaigns/${campaignId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete_asset', assetId }),
    });
    router.refresh();
  }

  return (
    <Card>
      <SectionTitle icon={Images} title={ar ? 'الصور والأصول' : 'Images & assets'} count={assets.length || undefined}
        action={
          <div className="flex gap-1.5">
            <button onClick={() => setShowPicker((v) => !v)} className="btn-subtle h-8 px-2.5 text-xs"><Search size={13} /> {ar ? 'من المنتجات' : 'From products'}</button>
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-primary h-8 px-2.5 text-xs"><Upload size={13} /> {ar ? 'رفع' : 'Upload'}</button>
          </div>
        }
      />
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />

      {showPicker && <ProductPicker ar={ar} onConfirm={attachProducts} onClose={() => setShowPicker(false)} />}

      {/* AI image edit: style/edit prompt applied to the source images */}
      {sourceAssets.length > 0 && (
        <div className="mb-4 rounded-lg border border-line bg-elevated/55 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-fg"><Wand2 size={13} className="text-accent" /> {ar ? 'تعديل الصور بالذكاء' : 'AI image edit'}</p>
          <textarea
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            rows={2}
            dir="auto"
            placeholder={ar ? 'وصف التعديل/الستايل… مثال: خلفية بيضاء نظيفة وإضاءة فاخرة' : 'Style / edit prompt… e.g. clean white background, premium lighting'}
            className="input resize-none text-sm"
          />
          <button onClick={generateEdits} disabled={busy} className="btn-primary mt-2 h-8 px-3 text-xs">
            <Wand2 size={13} /> {busy ? '…' : ar ? 'ولّد صور معدّلة' : 'Generate edited images'}
          </button>
        </div>
      )}

      {msg && <p className={`mb-2 text-xs ${msg.k === 'ok' ? 'text-success' : msg.k === 'info' ? 'text-info' : 'text-danger'}`}>{msg.t}</p>}

      {assets.length === 0 ? (
        <button
          onClick={() => fileRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface2/40 py-10 text-center transition hover:border-accent/40"
        >
          <ImagePlus size={26} className="text-faint" />
          <p className="text-sm font-medium text-fg">{ar ? 'ارفع صور المنتجات أو الحملة' : 'Upload product or campaign images'}</p>
          <p className="text-xs text-muted">{ar ? 'PNG/JPG · أو اختر من قاعدة المنتجات' : 'PNG/JPG · or pick from the product database'}</p>
        </button>
      ) : (
        <div className="space-y-5">
          <AssetSection title={ar ? 'الصور الأصلية' : 'Original uploaded images'} count={sourceAssets.length}>
            {sourceAssets.map((a) => <AssetTile key={a.id} asset={a} ar={ar} busy={busy} onRemove={remove} />)}
          </AssetSection>

          <AssetSection title={ar ? 'المخرجات المعدّلة' : 'Generated edited outputs'} count={editedAssets.length}>
            {editedAssets.length ? editedAssets.map((a) => (
              <AssetTile key={a.id} asset={a} ar={ar} busy={busy} onApprove={approve} onRegenerate={regenerate} onReject={reject} />
            )) : <p className="col-span-full rounded-lg border border-dashed border-line bg-surface2/40 py-5 text-center text-xs text-faint">{ar ? 'لا توجد صور معدّلة بعد' : 'No edited outputs yet'}</p>}
          </AssetSection>

          {approvedAssets.length > 0 && (
            <AssetSection title={ar ? 'الصور المعتمدة للنشر' : 'Approved images for posting'} count={approvedAssets.length}>
              {approvedAssets.map((a) => <AssetTile key={a.id} asset={a} ar={ar} busy={busy} onRegenerate={regenerate} onReject={reject} compact />)}
            </AssetSection>
          )}
        </div>
      )}
    </Card>
  );
}

function AssetSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">{title}</h3>
        <span className="rounded bg-surface2 px-1.5 py-0.5 text-[10px] text-muted">{count}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">{children}</div>
    </section>
  );
}

function AssetTile({
  asset,
  ar,
  busy,
  compact = false,
  onRemove,
  onApprove,
  onRegenerate,
  onReject,
}: {
  asset: Asset;
  ar: boolean;
  busy: boolean;
  compact?: boolean;
  onRemove?: (id: string) => void;
  onApprove?: (id: string) => void;
  onRegenerate?: (id: string) => void;
  onReject?: (id: string) => void;
}) {
  const edited = asset.kind === 'ai_edited_image';
  return (
    <div className={`group relative aspect-square overflow-hidden rounded-lg border bg-surface2 ${edited && asset.approved ? 'border-success ring-1 ring-success/70' : 'border-line'}`}>
      {asset.public_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={asset.public_url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-[10px] text-faint">{asset.kind}</div>
      )}
      <span className={`absolute start-1 top-1 rounded px-1.5 py-0.5 text-[9px] font-semibold ${asset.approved ? 'bg-success text-black' : 'bg-black/65 text-white'}`}>
        {edited ? (asset.approved ? (ar ? 'معتمدة' : 'Approved') : (ar ? 'معدّلة' : 'Edited')) : (ar ? 'أصلية' : 'Original')}
      </span>
      {edited ? (
        <div className={`absolute inset-x-1 bottom-1 flex justify-center gap-1 ${compact ? '' : 'opacity-0 transition group-hover:opacity-100'}`}>
          {!asset.approved && onApprove && (
            <button onClick={() => onApprove(asset.id)} disabled={busy} title={ar ? 'اعتماد' : 'Approve'} className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-success text-black"><Check size={13} /></button>
          )}
          {onRegenerate && <button onClick={() => onRegenerate(asset.id)} disabled={busy} title={ar ? 'إعادة توليد' : 'Regenerate'} className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-black/65 text-white hover:bg-accent hover:text-black"><RefreshCw size={13} /></button>}
          {onReject && <button onClick={() => onReject(asset.id)} disabled={busy} title={ar ? 'رفض' : 'Reject'} className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-black/65 text-white hover:bg-danger"><Trash2 size={13} /></button>}
        </div>
      ) : (
        onRemove && <button onClick={() => onRemove(asset.id)} className="absolute end-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md bg-black/65 text-white opacity-0 transition hover:bg-danger group-hover:opacity-100">
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

function ProductPicker({ ar, onConfirm, onClose }: { ar: boolean; onConfirm: (ids: string[]) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<FoundProduct[]>([]);
  const [picked, setPicked] = useState<Record<string, FoundProduct>>({});
  const [loading, setLoading] = useState(false);

  async function run(query: string) {
    setLoading(true);
    const res = await fetch(`/api/products/search?q=${encodeURIComponent(query)}`);
    const d = await res.json().catch(() => ({ rows: [] }));
    setRows(d.rows ?? []);
    setLoading(false);
  }

  function toggle(p: FoundProduct) {
    setPicked((cur) => {
      const next = { ...cur };
      if (next[p.id]) delete next[p.id];
      else next[p.id] = p;
      return next;
    });
  }

  const ids = Object.keys(picked);

  return (
    <div className="mb-3 rounded-xl border border-line bg-surface2/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute inset-y-0 my-auto start-3 text-faint" />
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); run(e.target.value); }} placeholder={ar ? 'ابحث عن منتجات…' : 'Search products…'} dir="auto" className="input ps-9 h-9" />
        </div>
        <button onClick={onClose} className="btn-subtle h-9 w-9 p-0"><X size={15} /></button>
      </div>
      <div className="scroll-thin max-h-48 space-y-1 overflow-y-auto">
        {loading ? (
          <p className="py-3 text-center text-xs text-faint">{ar ? 'بحث…' : 'Searching…'}</p>
        ) : rows.length === 0 ? (
          <p className="py-3 text-center text-xs text-faint">{q ? (ar ? 'لا نتائج' : 'No results') : ar ? 'اكتب للبحث' : 'Type to search'}</p>
        ) : (
          rows.map((p) => {
            const on = !!picked[p.id];
            return (
              <button key={p.id} onClick={() => toggle(p)} className={`flex w-full items-center gap-2.5 rounded-lg border p-2 text-start transition ${on ? 'border-accent/50 bg-accent/10' : 'border-line bg-surface hover:border-faint'}`}>
                <span className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-surface2">
                  {p.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image} alt="" className="h-full w-full object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg" dir="auto">{p.name}</span>
                  <span className="ltr-nums block text-xs text-faint">{p.price != null ? `${p.price} LYD` : '—'}</span>
                </span>
                {on && <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-black"><Plus size={13} className="rotate-45" /></span>}
              </button>
            );
          })
        )}
      </div>
      <button onClick={() => onConfirm(ids)} disabled={ids.length === 0} className="btn-primary mt-2 w-full">
        {ar ? `إضافة ${ids.length} منتج` : `Add ${ids.length} product${ids.length === 1 ? '' : 's'}`}
      </button>
    </div>
  );
}
