'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, CircleCheck, CircleAlert } from 'lucide-react';

interface Check { check_key: string; ok: boolean; summary: string | null; detail: any; checked_at: string }

const LABELS: Record<string, string> = {
  facebook_page: 'صفحة فيسبوك',
  instagram: 'حساب إنستغرام',
  webhooks: 'اشتراك الويبهوك',
  gemini: 'Gemini AI',
};

/**
 * Truthful per-channel readiness: what the last REAL provider checks proved.
 * A channel is never claimed connected without a passing check.
 */
export default function ChannelReadiness() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch('/api/settings/readiness').then((r) => r.json()).then((d) => setChecks(d.checks ?? [])).catch(() => setChecks([]));
  useEffect(() => { load(); }, []);

  const run = async () => {
    setBusy(true);
    try {
      await fetch('/api/settings/readiness', { method: 'POST' });
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!checks) return <div className="flex h-40 items-center justify-center text-muted"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          نتائج فحوصات حقيقية ضد مزوّدي الخدمة — لا حالة «متصل» بدون إثبات.
        </p>
        <button
          onClick={run}
          disabled={busy}
          className="btn-primary min-h-11 px-4"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} فحص الآن
        </button>
      </div>

      {checks.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface2/60 p-4 text-sm text-muted">
          لم يُجرَ أي فحص بعد — اضغط «فحص الآن».
        </p>
      ) : (
        <ul className="space-y-2">
          {checks.map((c) => {
            const detail = c.detail ?? {};
            return (
              <li key={c.check_key} className={`rounded-xl border p-4 ${c.ok ? 'border-success/30 bg-success/5' : 'border-warning/40 bg-warning/5'}`}>
                <div className="flex items-center gap-2">
                  {c.ok ? <CircleCheck size={16} className="text-success" /> : <CircleAlert size={16} className="text-warning" />}
                  <p className="text-sm font-bold text-fg">{LABELS[c.check_key] ?? c.check_key}</p>
                  <span className="ms-auto text-[10px] text-faint" dir="ltr">{new Date(c.checked_at).toLocaleString('ar-LY')}</span>
                </div>
                <p className="mt-1 text-sm text-fg" dir="auto">{c.summary}</p>
                {detail.remediation && (
                  <p className="mt-1.5 rounded-lg bg-surface2/80 p-2 text-xs text-muted" dir="auto">
                    🛠 {detail.remediation}
                  </p>
                )}
                {Array.isArray(detail.granted_permissions) && detail.granted_permissions.length > 0 && (
                  <p className="mt-1 text-[11px] text-faint" dir="ltr">permissions: {detail.granted_permissions.join(', ')}</p>
                )}
                {Array.isArray(detail.subscribed_fields) && (
                  <p className="mt-1 text-[11px] text-faint" dir="ltr">webhook fields: {detail.subscribed_fields.join(', ') || '—'}</p>
                )}
                {Array.isArray(detail.capabilities) && (
                  <p className="mt-1 text-[11px] text-faint" dir="ltr">capabilities: {detail.capabilities.join(', ')}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
