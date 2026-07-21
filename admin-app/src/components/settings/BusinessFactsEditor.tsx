'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Plus, Trash2 } from 'lucide-react';

interface Fact { key: string; value: unknown; label_ar: string | null; label_en: string | null }

/**
 * Structured Business Facts editor — branches, hours, phone, delivery flags,
 * order-handoff contacts. These feed the AI as verified runtime data.
 */
export default function BusinessFactsEditor() {
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/business-facts')
      .then((r) => r.json())
      .then((d) => {
        setFacts(d.facts ?? []);
        setDraft(Object.fromEntries((d.facts ?? []).map((f: Fact) => [f.key, f.value])));
      })
      .catch(() => setFacts([]));
  }, []);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/settings/business-facts', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ facts: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || 'failed');
      setMsg('تم الحفظ — يستخدمها الذكاء فوراً ✓');
    } catch (e: any) {
      setMsg(`خطأ: ${e?.message ?? 'فشل الحفظ'}`);
    } finally {
      setBusy(false);
    }
  };

  if (!facts) return <div className="flex h-40 items-center justify-center text-muted"><Loader2 className="animate-spin" /></div>;

  const label = (f: Fact) => f.label_ar || f.label_en || f.key;
  const branches = (draft.branches as string[]) ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        هذه هي الحقائق المعتمدة التي يجاوب بها المساعد (الفروع، الدوام، التوصيل، جهات الطلب).
        لا يخترع المساعد أي معلومة خارجها.
      </p>

      <div className="rounded-xl border border-line bg-surface2/50 p-4">
        <p className="mb-2 text-sm font-bold text-fg">الفروع</p>
        <ul className="space-y-2">
          {branches.map((b, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                value={b}
                onChange={(e) => setDraft({ ...draft, branches: branches.map((x, j) => (j === i ? e.target.value : x)) })}
                className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-accent/50"
                dir="rtl"
              />
              <button
                onClick={() => setDraft({ ...draft, branches: branches.filter((_, j) => j !== i) })}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-danger/10 hover:text-danger"
                aria-label="حذف الفرع"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={() => setDraft({ ...draft, branches: [...branches, ''] })}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-muted transition hover:bg-surface2"
        >
          <Plus size={14} /> إضافة فرع
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {facts.filter((f) => !['branches', 'delivery_available', 'pickup_available'].includes(f.key)).map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-xs font-semibold text-muted">{label(f)}</span>
            <input
              value={String(draft[f.key] ?? '')}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-accent/50"
              dir="auto"
            />
          </label>
        ))}
      </div>

      <div className="flex flex-wrap gap-4">
        {(['delivery_available', 'pickup_available'] as const).map((k) => {
          const f = facts.find((x) => x.key === k);
          if (!f) return null;
          return (
            <label key={k} className="flex min-h-11 items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={draft[k] === true}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })}
                className="h-4 w-4 accent-accent"
              />
              {label(f)}
            </label>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy}
          className="btn-primary min-h-11 px-4"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} حفظ الحقائق
        </button>
        {msg && <span className={`text-sm ${msg.startsWith('خطأ') ? 'text-danger' : 'text-success'}`}>{msg}</span>}
      </div>
    </div>
  );
}
