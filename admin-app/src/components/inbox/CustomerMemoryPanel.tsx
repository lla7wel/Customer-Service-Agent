'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Brain, Save, Trash2, Loader2, Check } from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';

interface RecentProduct { product_id: string; name: string; price: number | null; resolved_at: string; match_type: string }
interface Memory {
  summary: string | null;
  recent_products: RecentProduct[];
  preferences: Record<string, string>;
  known_facts: string[];
  known_name: string | null;
  known_phone: string | null;
  known_address: string | null;
  last_conversation_at: string | null;
}

/** Admin view/edit/clear of a customer's persistent AI memory. */
export default function CustomerMemoryPanel({ conversationId, memory, locale }: { conversationId: string; memory: Memory | null; locale: Locale }) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(memory?.summary ?? '');
  const [name, setName] = useState(memory?.known_name ?? '');
  const [phone, setPhone] = useState(memory?.known_phone ?? '');
  const [address, setAddress] = useState(memory?.known_address ?? '');
  const [facts, setFacts] = useState((memory?.known_facts ?? []).join('\n'));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function act(action: string, body: Record<string, unknown> = {}) {
    const res = await fetch(`/api/inbox/${conversationId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...body }),
    });
    return res.ok;
  }

  async function save() {
    setBusy(true); setSaved(false);
    const ok = await act('update_memory', {
      summary, known_name: name, known_phone: phone, known_address: address,
      known_facts: facts.split('\n').map((s) => s.trim()).filter(Boolean),
    });
    setBusy(false);
    if (ok) { setSaved(true); setEditing(false); router.refresh(); }
  }

  async function clear() {
    if (!confirm(ar ? 'مسح ذاكرة هذا العميل؟' : 'Clear this customer\'s memory?')) return;
    setBusy(true);
    const ok = await act('clear_memory');
    setBusy(false);
    if (ok) router.refresh();
  }

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={15} className="text-accent" />
          <h3 className="text-sm font-semibold text-fg">{ar ? 'ذاكرة العميل' : 'Customer memory'}</h3>
        </div>
        <div className="flex items-center gap-2">
          {!editing && <button onClick={() => setEditing(true)} className="text-xs text-accent hover:underline">{ar ? 'تعديل' : 'Edit'}</button>}
          <button onClick={clear} disabled={busy} className="text-xs text-danger hover:underline inline-flex items-center gap-1"><Trash2 size={12} /> {ar ? 'مسح' : 'Clear'}</button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <MemField label={ar ? 'ملخّص' : 'Summary'} value={summary} onChange={setSummary} rows={3} />
          <MemField label={ar ? 'الاسم' : 'Name'} value={name} onChange={setName} />
          <MemField label={ar ? 'الهاتف' : 'Phone'} value={phone} onChange={setPhone} />
          <MemField label={ar ? 'العنوان' : 'Address'} value={address} onChange={setAddress} />
          <MemField label={ar ? 'حقائق (سطر لكل حقيقة)' : 'Facts (one per line)'} value={facts} onChange={setFacts} rows={3} />
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setEditing(false)} className="btn-ghost h-8 px-2.5 text-xs">{ar ? 'إلغاء' : 'Cancel'}</button>
            <button onClick={save} disabled={busy} className="btn-primary h-8 px-2.5 text-xs">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {ar ? 'حفظ' : 'Save'}
            </button>
          </div>
        </div>
      ) : !memory ? (
        <p className="text-xs text-faint">{ar ? 'لا توجد ذاكرة بعد لهذا العميل.' : 'No memory stored yet for this customer.'}</p>
      ) : (
        <div className="space-y-2 text-xs">
          {saved && <p className="flex items-center gap-1 text-success"><Check size={12} /> {ar ? 'تم الحفظ' : 'Saved'}</p>}
          {memory.summary && <Row label={ar ? 'ملخّص' : 'Summary'} value={memory.summary} />}
          {memory.known_name && <Row label={ar ? 'الاسم' : 'Name'} value={memory.known_name} />}
          {memory.known_phone && <Row label={ar ? 'الهاتف' : 'Phone'} value={memory.known_phone} />}
          {memory.known_address && <Row label={ar ? 'العنوان' : 'Address'} value={memory.known_address} />}
          {memory.known_facts?.length > 0 && <Row label={ar ? 'حقائق' : 'Facts'} value={memory.known_facts.join(' · ')} />}
          {memory.recent_products?.length > 0 && (
            <div>
              <p className="mb-1 text-faint">{ar ? 'منتجات سابقة' : 'Recent products'}</p>
              <ul className="space-y-0.5">
                {memory.recent_products.slice(0, 5).map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-sm border border-line bg-surface2 px-2 py-1">
                    <span className="min-w-0 truncate text-fg" dir="auto">{p.name}</span>
                    <span className="shrink-0 text-success">{p.price != null ? `${p.price} د.ل` : '—'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!memory.summary && !memory.known_name && !memory.recent_products?.length && (
            <p className="text-faint">{ar ? 'الذاكرة فارغة حتى الآن.' : 'Memory is empty so far.'}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="grid gap-0.5 sm:grid-cols-[70px_1fr]">
      <span className="text-faint">{label}</span>
      <span className="wrap-break-word text-fg" dir="auto">{value}</span>
    </p>
  );
}

function MemField({ label, value, onChange, rows = 1 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-muted">{label}</span>
      {rows > 1
        ? <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} dir="auto" className="input resize-y text-xs" />
        : <input value={value} onChange={(e) => onChange(e.target.value)} dir="auto" className="input h-8 text-xs" />}
    </label>
  );
}
