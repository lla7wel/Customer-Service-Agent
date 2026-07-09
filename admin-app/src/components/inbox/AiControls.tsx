'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play, CheckCircle2, Bot } from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';

/** Pause/resume the AI and mark a conversation resolved. */
export default function AiControls({
  conversationId,
  aiEnabled,
  locale,
}: {
  conversationId: string;
  aiEnabled: boolean;
  locale: Locale;
}) {
  const router = useRouter();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function act(action: string) {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/inbox/${conversationId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else {
      const d = await res.json().catch(() => ({}));
      setErr(d?.missing?.join(', ') || d?.error || 'Failed');
    }
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot size={15} className="text-accent" />
          <h3 className="text-sm font-semibold text-fg">{ar ? 'تحكّم الذكاء' : 'AI control'}</h3>
        </div>
        <span className={`chip ${aiEnabled ? 'bg-success/12 text-success ring-success/25' : 'bg-warning/12 text-warning ring-warning/25'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${aiEnabled ? 'bg-success' : 'bg-warning'}`} />
          {aiEnabled ? (ar ? 'مفعّل' : 'Active') : ar ? 'متوقف' : 'Paused'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => act(aiEnabled ? 'pause_ai' : 'resume_ai')}
          disabled={busy}
          className={aiEnabled ? 'btn bg-warning/15 text-warning hover:bg-warning/25' : 'btn bg-success/15 text-success hover:bg-success/25'}
        >
          {aiEnabled ? <Pause size={15} /> : <Play size={15} />}
          {aiEnabled ? (ar ? 'إيقاف' : 'Pause') : ar ? 'تشغيل' : 'Resume'}
        </button>
        <button onClick={() => act('mark_resolved')} disabled={busy} className="btn-ghost">
          <CheckCircle2 size={15} /> {ar ? 'تم الحل' : 'Resolve'}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
    </div>
  );
}
