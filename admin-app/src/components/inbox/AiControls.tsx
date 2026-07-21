'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserCheck, Play, CheckCircle2, Bot } from 'lucide-react';
import type { Locale } from '@/lib/i18n/config';

/**
 * Take Over / Resume AI — the explicit human handover controls.
 *
 * Take Over pauses the assistant entirely (a human owns the thread).
 * Resume AI restores normal contextual conversation: the assistant keeps the
 * full persisted history and memory, so it never restarts confused.
 */
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
          {aiEnabled ? (ar ? 'الذكاء يجاوب' : 'AI replying') : ar ? 'موظف مستلم' : 'Human active'}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          onClick={() => act(aiEnabled ? 'take_over' : 'resume_ai')}
          disabled={busy}
          className={`min-h-11 ${aiEnabled ? 'btn bg-warning/15 text-warning hover:bg-warning/25' : 'btn bg-success/15 text-success hover:bg-success/25'}`}
        >
          {aiEnabled ? <UserCheck size={15} /> : <Play size={15} />}
          {aiEnabled ? (ar ? 'استلام المحادثة' : 'Take over') : ar ? 'استئناف الذكاء' : 'Resume AI'}
        </button>
        <button onClick={() => act('mark_resolved')} disabled={busy} className="btn-ghost min-h-11">
          <CheckCircle2 size={15} /> {ar ? 'تم الحل' : 'Resolve'}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-faint">
        {aiEnabled
          ? (ar ? 'الاستلام يوقف ردود الذكاء تماماً حتى تستأنفه.' : 'Taking over stops AI replies until you resume.')
          : (ar ? 'الاستئناف يرجّع الذكاء بنفس سياق المحادثة الكامل.' : 'Resuming restores the AI with the full conversation context.')}
      </p>
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
    </div>
  );
}
