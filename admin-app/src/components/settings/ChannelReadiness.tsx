'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, CircleCheck, CircleAlert, Copy, ExternalLink } from 'lucide-react';

interface Check { check_key: string; ok: boolean; summary: string | null; detail: any; checked_at: string }

const LABELS: Record<string, string> = {
  facebook_page: 'صفحة فيسبوك',
  instagram: 'حساب إنستغرام',
  insights: 'رؤى فيسبوك وإنستغرام',
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
  const [callbackUrl, setCallbackUrl] = useState('/api/meta/webhook');
  const [copied, setCopied] = useState<string | null>(null);

  const load = () =>
    fetch('/api/settings/readiness').then((r) => r.json()).then((d) => setChecks(d.checks ?? [])).catch(() => setChecks([]));
  useEffect(() => { load(); setCallbackUrl(`${window.location.origin}/api/meta/webhook`); }, []);

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  };

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
      <section className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-line bg-surface2/45 p-4">
          <b className="text-sm text-fg">1. ربط إنستغرام بالصفحة</b>
          <p className="mt-1 text-xs leading-5 text-muted">من إعدادات Meta Business اربط حساب إنستغرام الاحترافي بصفحة English Home Libya.</p>
          <a href="https://business.facebook.com/settings/instagram-business-accounts" target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent hover:underline">فتح إعدادات Meta <ExternalLink size={14}/></a>
        </div>
        <div className="rounded-xl border border-line bg-surface2/45 p-4">
          <b className="text-sm text-fg">2. الصلاحيات والويبهوك</b>
          <p className="mt-1 text-xs leading-5 text-muted">فعّل رسائل وتعليقات ونشر إنستغرام، وصلاحيتي pages_read_engagement وread_insights.</p>
          <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent hover:underline">فتح تطبيقات Meta <ExternalLink size={14}/></a>
        </div>
        <div className="rounded-xl border border-line bg-surface2/45 p-4">
          <b className="text-sm text-fg">3. رابط الويبهوك الجاهز</b>
          <p className="mt-1 break-all font-mono text-[11px] text-muted" dir="ltr">{callbackUrl}</p>
          <button type="button" onClick={() => copy(callbackUrl, 'callback')} className="btn-secondary mt-3 min-h-11"><Copy size={14}/>{copied === 'callback' ? 'تم النسخ' : 'نسخ الرابط'}</button>
        </div>
      </section>
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
                {detail.linked_ig_user_id && (
                  <button type="button" onClick={() => copy(String(detail.linked_ig_user_id), `ig:${c.check_key}`)} className="btn-secondary mt-2 min-h-10" dir="ltr"><Copy size={13}/>{copied === `ig:${c.check_key}` ? 'Copied' : `META_IG_USER_ID=${detail.linked_ig_user_id}`}</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
