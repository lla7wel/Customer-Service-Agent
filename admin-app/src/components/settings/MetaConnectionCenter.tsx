'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, CircleCheck, CircleAlert, Copy, Facebook, Wrench, Plug, Unplug, ShieldCheck } from 'lucide-react';

interface Check { check_key: string; ok: boolean; summary: string | null; detail: any; checked_at: string }
interface Connection {
  configured: boolean; source: string; appId: string | null; pageId: string | null; pageName: string | null;
  igUserId: string | null; igUsername: string | null; grantedScopes: string[]; tokenExpiresAt: string | null;
  pageTokenTail: string | null; pageSubscribedFields: string[]; igSubscribedFields: string[]; status: string;
  connectedAt: string | null; lastVerifiedAt: string | null; lastWebhookAt: string | null;
  hasPageToken: boolean; hasAppSecret: boolean; hasVerifyToken: boolean;
}
interface Payload { connection: Connection; readiness: Check[]; encryption_configured: boolean; urls: { oauth_redirect: string; webhook_callback: string } }

const READINESS_LABELS: Record<string, string> = {
  facebook_page: 'صفحة فيسبوك', instagram: 'حساب إنستغرام', insights: 'الرؤى (Insights)', webhooks: 'اشتراك الويبهوك', gemini: 'Gemini AI',
};

function fmt(iso: string | null): string { return iso ? new Date(iso).toLocaleString('ar-LY', { timeZone: 'Africa/Tripoli', dateStyle: 'short', timeStyle: 'short' }) : '—'; }

export default function MetaConnectionCenter() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manual, setManual] = useState({ page_id: '', page_access_token: '', app_secret: '', verify_token: '', ig_user_id: '' });

  const load = () => fetch('/api/settings/channels/meta').then((r) => r.json()).then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, []);

  const copy = async (v: string, k: string) => { try { await navigator.clipboard.writeText(v); setCopied(k); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked */ } };

  const post = async (body: any, label: string) => {
    setBusy(label); setMsg(null);
    try {
      const res = await fetch('/api/settings/channels/meta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.detail || d?.error || 'failed');
      return d;
    } catch (e: any) { setMsg({ ok: false, text: `خطأ: ${e?.message}` }); return null; }
    finally { setBusy(null); }
  };

  const connectFacebook = async () => {
    setBusy('oauth');
    try {
      const res = await fetch('/api/settings/channels/meta/oauth/start', { method: 'POST' });
      const d = await res.json();
      if (res.ok && d?.url) { window.location.href = d.url; return; }
      setMsg({ ok: false, text: d?.detail || 'تعذّر بدء تسجيل الدخول عبر فيسبوك — استخدم الإعداد اليدوي.' });
    } finally { setBusy(null); }
  };

  const saveManual = async () => {
    const d = await post({ action: 'manual', ...manual }, 'manual');
    if (d) { setMsg({ ok: d.validation?.ok, text: d.validation?.ok ? 'تم الحفظ والتحقق من الصفحة ✓' : `حُفظ لكن فشل التحقق: ${d.validation?.error ?? ''}` }); await load(); }
  };
  const repair = async () => { const d = await post({ action: 'repair' }, 'repair'); if (d) { const r = d.result; setMsg({ ok: d.ok, text: d.ok ? 'تم إصلاح الاشتراكات والتحقق منها ✓' : `الصفحة: ${r?.page?.ok ? 'تمام' : 'ناقص'} · ${r?.error ?? ''}` }); await load(); } };
  const runCheck = async () => { const d = await post({ action: 'check' }, 'check'); if (d) { setMsg({ ok: true, text: 'تم تشغيل الفحص ✓' }); await load(); } };
  const disconnect = async () => { if (!confirm('فصل الاتصال بحساب Meta؟')) return; const d = await post({ action: 'disconnect' }, 'disconnect'); if (d) { setMsg({ ok: true, text: 'تم الفصل' }); await load(); } };

  if (!data) return <div className="flex h-40 items-center justify-center text-muted"><Loader2 className="animate-spin" /></div>;
  const c = data.connection;

  return (
    <div className="space-y-4">
      {!data.encryption_configured && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          مفتاح التشفير <span className="font-mono">INTEGRATION_ENCRYPTION_KEY</span> غير مضبوط على الخادم — لا يمكن حفظ بيانات الاعتماد بأمان حتى يُضبط.
        </div>
      )}

      {/* connection status */}
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2"><Facebook className="text-navy" size={20} /><b className="text-fg">اتصال Meta</b>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c.configured ? 'bg-success/12 text-success' : 'bg-surface2 text-muted'}`}>{c.configured ? 'متصل' : 'غير متصل'}</span>
            <span className="rounded-full bg-surface2 px-2 py-0.5 text-[11px] text-muted">المصدر: {c.source}</span>
          </div>
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Row k="الصفحة" v={c.pageName ? `${c.pageName} (${c.pageId})` : c.pageId ?? '—'} />
          <Row k="إنستغرام" v={c.igUsername ? `@${c.igUsername}` : c.igUserId ?? '—'} />
          <Row k="رمز الصفحة" v={c.pageTokenTail ?? '—'} />
          <Row k="انتهاء الرمز" v={fmt(c.tokenExpiresAt)} />
          <Row k="اشتراكات الصفحة" v={c.pageSubscribedFields.join('، ') || '—'} />
          <Row k="اشتراكات إنستغرام" v={c.igSubscribedFields.join('، ') || '—'} />
          <Row k="آخر تحقق" v={fmt(c.lastVerifiedAt)} />
          <Row k="آخر ويبهوك مستلم" v={fmt(c.lastWebhookAt)} />
        </dl>
      </section>

      {/* the two URLs — deliberately separate; they are NOT interchangeable */}
      <section className="grid gap-3 lg:grid-cols-2">
        <UrlCard title="رابط إعادة توجيه OAuth" where="في إعدادات تطبيق فيسبوك ← Facebook Login ← Valid OAuth Redirect URIs" url={data.urls.oauth_redirect} copied={copied === 'oauth'} onCopy={() => copy(data.urls.oauth_redirect, 'oauth')} />
        <UrlCard title="رابط الويبهوك (Callback URL)" where="في إعدادات المنتج Webhooks ← Callback URL (مع Verify Token)" url={data.urls.webhook_callback} copied={copied === 'wh'} onCopy={() => copy(data.urls.webhook_callback, 'wh')} />
      </section>

      {/* actions */}
      <section className="flex flex-wrap gap-2">
        <button onClick={connectFacebook} disabled={busy !== null} className="btn-primary min-h-11">{busy === 'oauth' ? <Loader2 className="animate-spin" size={16} /> : <Facebook size={16} />} الربط عبر فيسبوك</button>
        <button onClick={() => setShowManual((s) => !s)} className="btn-secondary min-h-11"><Plug size={16} /> إعداد يدوي</button>
        <button onClick={repair} disabled={busy !== null || !c.configured} className="btn-secondary min-h-11">{busy === 'repair' ? <Loader2 className="animate-spin" size={16} /> : <Wrench size={16} />} إصلاح الاشتراكات</button>
        <button onClick={runCheck} disabled={busy !== null} className="btn-secondary min-h-11">{busy === 'check' ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />} فحص شامل</button>
        {c.configured && <button onClick={disconnect} disabled={busy !== null} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-danger/30 px-3 text-sm font-medium text-danger transition hover:bg-danger/5"><Unplug size={15} /> فصل</button>}
      </section>

      {showManual && (
        <section className="rounded-2xl border border-line bg-surface2/40 p-4">
          <p className="mb-3 text-sm font-bold text-fg">إعداد يدوي (بديل آمن — لا تحتاج طرفية)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Page ID" v={manual.page_id} onChange={(v) => setManual({ ...manual, page_id: v })} />
            <Field label="Instagram User ID (اختياري)" v={manual.ig_user_id} onChange={(v) => setManual({ ...manual, ig_user_id: v })} />
            <Field label="Page Access Token" v={manual.page_access_token} onChange={(v) => setManual({ ...manual, page_access_token: v })} secret />
            <Field label="App Secret" v={manual.app_secret} onChange={(v) => setManual({ ...manual, app_secret: v })} secret />
            <Field label="Verify Token" v={manual.verify_token} onChange={(v) => setManual({ ...manual, verify_token: v })} secret />
          </div>
          <button onClick={saveManual} disabled={busy !== null || !manual.page_id || !manual.page_access_token} className="btn-primary mt-3 min-h-11">{busy === 'manual' ? <Loader2 className="animate-spin" size={16} /> : <Plug size={16} />} حفظ وتحقق</button>
          <p className="mt-2 text-[11px] text-muted">تُخزَّن كل الأسرار مشفّرة (AES-256-GCM). لا تُعرض قيمتها أبداً في المتصفح.</p>
        </section>
      )}

      {msg && <p className={`text-sm ${msg.ok ? 'text-success' : 'text-danger'}`} dir="auto">{msg.text}</p>}

      {/* honest readiness — capability-proven only */}
      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="mb-2 flex items-center justify-between"><b className="text-sm text-fg">الجاهزية (مثبتة بفحص حقيقي)</b><button onClick={runCheck} disabled={busy !== null} className="inline-flex items-center gap-1 text-xs text-accent hover:underline"><RefreshCw size={13} /> تحديث</button></div>
        {data.readiness.length === 0 ? <p className="text-xs text-muted">لم يُشغّل أي فحص بعد.</p> : (
          <ul className="divide-y divide-line">
            {data.readiness.map((r) => (
              <li key={r.check_key} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex items-center gap-2">{r.ok ? <CircleCheck className="text-success" size={16} /> : <CircleAlert className="text-warning" size={16} />}<span className="text-fg">{READINESS_LABELS[r.check_key] ?? r.check_key}</span></span>
                <span className="min-w-0 flex-1 truncate text-end text-xs text-muted" dir="auto">{r.summary}</span>
                <span className="shrink-0 text-[11px] text-faint">{fmt(r.checked_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) { return <div className="flex items-center justify-between gap-2 border-b border-line/60 py-1.5"><dt className="text-muted">{k}</dt><dd className="min-w-0 truncate text-end font-medium text-fg" dir="auto">{v}</dd></div>; }
function UrlCard({ title, where, url, copied, onCopy }: { title: string; where: string; url: string; copied: boolean; onCopy: () => void }) {
  return <div className="rounded-xl border border-line bg-surface2/45 p-4"><b className="text-sm text-fg">{title}</b><p className="mt-1 text-[11px] leading-5 text-muted">{where}</p><div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-surface p-2"><code className="min-w-0 flex-1 truncate text-xs text-fg" dir="ltr">{url}</code><button onClick={onCopy} className="shrink-0 rounded-md p-1.5 text-muted hover:bg-surface2" aria-label="Copy">{copied ? <CircleCheck size={15} className="text-success" /> : <Copy size={15} />}</button></div></div>;
}
function Field({ label, v, onChange, secret }: { label: string; v: string; onChange: (v: string) => void; secret?: boolean }) {
  return <label className="block text-xs text-muted">{label}<input type={secret ? 'password' : 'text'} value={v} onChange={(e) => onChange(e.target.value)} dir="ltr" className="input mt-1 min-h-11" autoComplete="off" /></label>;
}
