'use client';

import { useCallback, useEffect, useState } from 'react';
import { Boxes, Loader2, Lock, Plus, Trash2 } from 'lucide-react';

interface Sibling {
  id: string; product_code: string; english_name: string | null; arabic_name: string | null;
  libyan_display_name: string | null; variant_label: string | null; active_price: number | null; status: string;
}
interface Relation {
  relation_id: string; relation_type: string; source: string; locked: boolean;
  id: string; product_code: string; english_name: string | null; arabic_name: string | null;
  libyan_display_name: string | null; active_price: number | null; status: string;
}
interface FamilyData {
  family: { id: string; name: string; name_ar: string | null; kind: string } | null;
  family_locked: boolean;
  variant_label: string | null;
  siblings: Sibling[];
  relations: Relation[];
}

const REL_AR: Record<string, string> = {
  variant: 'خيار/مقاس', set_member: 'ضمن الطقم', complementary: 'مكمّل', similar: 'مشابه',
};

const name = (p: { libyan_display_name: string | null; arabic_name: string | null; english_name: string | null; product_code: string }) =>
  p.libyan_display_name || p.arabic_name || p.english_name || p.product_code;

/**
 * Family & related products — admin corrections here are permanent
 * (family_locked / relation locked) and survive automatic regrouping.
 */
export default function FamilyPanel({ productId, ar }: { productId: string; ar: boolean }) {
  const [data, setData] = useState<FamilyData | null>(null);
  const [busy, setBusy] = useState(false);
  const [addQ, setAddQ] = useState('');
  const [addResults, setAddResults] = useState<any[]>([]);

  const load = useCallback(
    () => fetch(`/api/products/${productId}/family`).then((r) => r.json()).then(setData).catch(() => {}),
    [productId],
  );
  useEffect(() => { void load(); }, [load]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    await fetch(`/api/products/${productId}/family`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    await load();
    setBusy(false);
  };

  const search = async (q: string) => {
    setAddQ(q);
    if (q.trim().length < 2) { setAddResults([]); return; }
    const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`);
    const d = await res.json().catch(() => ({ rows: [] }));
    setAddResults((d.rows ?? []).filter((p: any) => p.id !== productId).slice(0, 6));
  };

  if (!data) {
    return <div className="card flex h-24 items-center justify-center p-4 text-muted"><Loader2 size={16} className="animate-spin" /></div>;
  }

  return (
    <div className="card p-4">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
        <Boxes size={14} /> {ar ? 'العائلة والمنتجات المرتبطة' : 'Family & related products'}
        {data.family_locked && <span className="flex items-center gap-1 text-[10px] text-accent"><Lock size={10} /> {ar ? 'تصحيح إداري' : 'admin-corrected'}</span>}
      </h3>

      {data.family ? (
        <p className="mb-2 text-sm text-fg" dir="auto">
          {ar ? 'العائلة:' : 'Family:'} <span className="font-semibold">{data.family.name_ar || data.family.name}</span>
          {data.variant_label && <span className="ms-2 rounded-full bg-surface2 px-2 py-0.5 text-xs text-muted">{data.variant_label}</span>}
        </p>
      ) : (
        <p className="mb-2 text-sm text-muted">{ar ? 'غير مرتبط بعائلة.' : 'Not in a family.'}</p>
      )}

      {data.siblings.length > 0 && (
        <ul className="mb-3 space-y-1">
          {data.siblings.slice(0, 8).map((s) => (
            <li key={s.id}>
              <a href={`/catalog/${s.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-surface2/60">
                <span className="min-w-0 truncate text-fg" dir="auto">{name(s)}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                  {s.variant_label && <span>{s.variant_label}</span>}
                  {s.active_price != null && <span className="ltr-nums text-success">{s.active_price} د.ل</span>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {data.relations.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-[11px] font-semibold text-faint">{ar ? 'روابط يدوية/تلقائية' : 'Explicit relations'}</p>
          <ul className="space-y-1">
            {data.relations.map((r) => (
              <li key={r.relation_id} className="flex items-center gap-2 rounded-lg border border-line bg-surface2/40 px-2 py-1.5 text-sm">
                <a href={`/catalog/${r.id}`} className="min-w-0 flex-1 truncate text-fg hover:text-accent" dir="auto">{name(r)}</a>
                <span className="shrink-0 rounded-full bg-surface2 px-2 py-0.5 text-[10px] text-muted">
                  {ar ? (REL_AR[r.relation_type] ?? r.relation_type) : r.relation_type}
                </span>
                <button
                  onClick={() => act({ action: 'remove_relation', relationId: r.relation_id })}
                  disabled={busy}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-danger/10 hover:text-danger"
                  aria-label={ar ? 'حذف الرابط' : 'Remove relation'}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="relative">
        <input
          value={addQ}
          onChange={(e) => search(e.target.value)}
          placeholder={ar ? 'أضف منتجاً مرتبطاً (بحث)…' : 'Add a related product (search)…'}
          className="input h-10 text-sm"
          dir="auto"
        />
        {addResults.length > 0 && (
          <div className="absolute inset-x-0 top-full z-20 mt-1 rounded-xl border border-line bg-surface shadow-card">
            {addResults.map((p) => (
              <button
                key={p.id}
                onClick={() => { setAddResults([]); setAddQ(''); act({ action: 'add_relation', relatedProductId: p.id, relationType: 'complementary' }); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm transition hover:bg-surface2"
              >
                <Plus size={13} className="text-accent" />
                <span className="min-w-0 flex-1 truncate text-fg" dir="auto">{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
