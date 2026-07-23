'use client';

import { useEffect, useState } from 'react';
import { Loader2, UserPlus, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';

interface AdminRow {
  id: string; username: string; display_name: string | null; role: string;
  is_active: boolean; last_login_at: string | null;
}

type Role = 'owner' | 'analyzer' | 'poster' | 'messager';

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'owner', label: 'المالك — كل الصلاحيات' },
  { value: 'analyzer', label: 'محلّل — التحليلات + الرسائل + المحتوى' },
  { value: 'messager', label: 'مراسل — الرسائل + المحتوى' },
  { value: 'poster', label: 'ناشر — المحتوى فقط' },
];
const ROLE_BADGE: Record<string, string> = { owner: 'المالك', analyzer: 'محلّل', messager: 'مراسل', poster: 'ناشر' };

/** Owner-driven admin management: create, disable, reset password, assign role. */
export default function AdminsManager() {
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState<{ username: string; display_name: string; password: string; role: Role }>(
    { username: '', display_name: '', password: '', role: 'messager' },
  );

  const load = () =>
    fetch('/api/admins').then((r) => r.json()).then((d) => setAdmins(d.admins ?? [])).catch(() => setAdmins([]));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy('create');
    setMsg(null);
    try {
      const res = await fetch('/api/admins', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || 'failed');
      setForm({ username: '', display_name: '', password: '', role: 'messager' });
      setMsg('تم إنشاء الحساب ✓');
      await load();
    } catch (e: any) {
      setMsg(`خطأ: ${e?.message}`);
    } finally {
      setBusy(null);
    }
  };

  const update = async (id: string, body: Record<string, unknown>, label: string) => {
    setBusy(label);
    setMsg(null);
    try {
      const res = await fetch(`/api/admins/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || 'failed');
      await load();
    } catch (e: any) {
      setMsg(`خطأ: ${e?.message}`);
    } finally {
      setBusy(null);
    }
  };

  const resetPassword = async (a: AdminRow) => {
    const pw = window.prompt(`كلمة مرور جديدة للمشرف ${a.username} (10 أحرف على الأقل):`);
    if (!pw) return;
    await update(a.id, { password: pw }, `pw:${a.id}`);
    setMsg('تم تغيير كلمة المرور — الجلسات القديمة أُلغيت ✓');
  };

  if (!admins) return <div className="flex h-40 items-center justify-center text-muted"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {admins.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface2/50 p-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-sm font-bold text-fg">
              {(a.display_name || a.username)[0]?.toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg" dir="auto">
                {a.display_name || a.username}
                <span className={`ms-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${a.role === 'owner' ? 'bg-accent/15 text-accent' : 'bg-surface text-muted'}`}>{ROLE_BADGE[a.role] ?? a.role}</span>
                {!a.is_active && <span className="ms-2 rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold text-danger">معطّل</span>}
              </p>
              <p className="text-xs text-muted" dir="ltr">@{a.username}</p>
            </div>
            <label className="flex min-h-11 items-center gap-1.5 text-xs text-muted">
              <span className="sr-only">الدور</span>
              <select
                value={a.role}
                onChange={(e) => update(a.id, { role: e.target.value }, `role:${a.id}`)}
                disabled={busy !== null}
                className="min-h-11 rounded-lg border border-line bg-surface px-2 text-xs text-fg outline-none focus:border-accent/50"
              >
                {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            {a.role !== 'owner' && (
              <button
                onClick={() => update(a.id, { is_active: !a.is_active }, `act:${a.id}`)}
                disabled={busy !== null}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-fg transition hover:bg-surface2"
              >
                {a.is_active ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}
                {a.is_active ? 'تعطيل' : 'تفعيل'}
              </button>
            )}
            <button
              onClick={() => resetPassword(a)}
              disabled={busy !== null}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-fg transition hover:bg-surface2"
            >
              <KeyRound size={13} /> كلمة المرور
            </button>
          </li>
        ))}
      </ul>

      <div className="rounded-xl border border-line bg-surface2/50 p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-bold text-fg"><UserPlus size={15} /> إضافة مشرف جديد</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="اسم المستخدم (لاتيني)"
            className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-accent/50"
            dir="ltr"
          />
          <input
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            placeholder="الاسم الظاهر"
            className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-accent/50"
            dir="auto"
          />
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="كلمة المرور (10+ أحرف)"
            className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-accent/50"
            dir="ltr"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex min-h-11 items-center gap-2 text-sm text-fg">
            الدور
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-accent/50"
            >
              {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <button
            onClick={create}
            disabled={busy !== null || !form.username || form.password.length < 10}
            className="btn-primary min-h-11 px-4"
          >
            {busy === 'create' ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} إنشاء الحساب
          </button>
        </div>
      </div>
      {msg && <p className={`text-sm ${msg.startsWith('خطأ') ? 'text-danger' : 'text-success'}`}>{msg}</p>}
    </div>
  );
}
