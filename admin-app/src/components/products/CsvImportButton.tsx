'use client';

import { useRef, useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';

/**
 * CSV catalog import — uploads the file, the worker applies it automatically
 * to UNLOCKED fields (admin locks always win; no approval queue). Shows the
 * truthful run summary from the API.
 */
export default function CsvImportButton({ ar }: { ar: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/imports', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || 'failed');
      setMsg(ar
        ? `تم رفع ${data.rows} صفاً — الاستيراد يعمل في الخلفية والحقول المقفولة إدارياً محمية.`
        : `${data.rows} rows uploaded — importing in the background; admin-locked fields stay protected.`);
    } catch (e: any) {
      setMsg((ar ? 'خطأ: ' : 'Error: ') + (e?.message ?? 'failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={fileRef} type="file" accept=".csv,text/csv" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ''; }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-fg shadow-card transition hover:bg-surface2 disabled:opacity-60"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
        {ar ? 'استيراد CSV' : 'Import CSV'}
      </button>
      {msg && <p className={`max-w-72 text-end text-[11px] ${msg.startsWith('خطأ') || msg.startsWith('Error') ? 'text-danger' : 'text-success'}`}>{msg}</p>}
    </div>
  );
}
