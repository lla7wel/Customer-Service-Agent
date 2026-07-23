'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2 } from 'lucide-react';

/** Quick-create: choose post/story + platforms → draft → editor. */
export default function CreateContentButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [contentType, setContentType] = useState<'post' | 'story'>('post');
  const [platforms, setPlatforms] = useState<string[]>(['facebook', 'instagram']);
  const [error, setError] = useState<string | null>(null);

  const toggle = (p: string) =>
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const create = async () => {
    if (!platforms.length) { setError('اختر منصة واحدة على الأقل'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/content', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content_type: contentType, platforms }),
      });
      const data = await res.json();
      if (!res.ok || !data?.item?.id) throw new Error(data?.detail || data?.error || 'failed');
      router.push(`/content-studio/${data.item.id}`);
    } catch (e: any) {
      setError(e?.message ?? 'حدث خطأ');
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn-primary min-h-11 px-4"
      >
        <Plus size={16} />
        محتوى جديد
      </button>
      {open && (
        <div className="absolute end-0 top-full z-30 mt-2 w-72 rounded-xl border border-line bg-surface p-4 shadow-card">
          <p className="mb-2 text-xs font-semibold text-muted">النوع</p>
          <div className="mb-3 grid grid-cols-2 gap-2">
            {(['post', 'story'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setContentType(t)}
                className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  contentType === t ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-muted hover:bg-surface2'
                }`}
              >
                {t === 'post' ? '🖼️ منشور' : '📱 ستوري'}
              </button>
            ))}
          </div>
          <p className="mb-2 text-xs font-semibold text-muted">المنصات</p>
          <div className="mb-3 grid grid-cols-2 gap-2">
            {(['facebook', 'instagram'] as const).map((p) => (
              <button
                key={p}
                onClick={() => toggle(p)}
                className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  platforms.includes(p) ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-muted hover:bg-surface2'
                }`}
              >
                {p === 'facebook' ? 'فيسبوك' : 'إنستغرام'}
              </button>
            ))}
          </div>
          {error && <p className="mb-2 text-xs text-danger">{error}</p>}
          <button
            onClick={create}
            disabled={busy}
            className="btn-primary min-h-11 w-full"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : null}
            إنشاء
          </button>
        </div>
      )}
    </div>
  );
}
