'use client';

import { useEffect, useState } from 'react';
import { Loader2, UserPlus, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';

interface AdminRow {
  id: string; username: string; display_name: string | null; role: string;
  full_access: boolean; is_active: boolean; last_login_at: string | null;
}

/** Owner-driven admin management: create, disable, reset password, full access. */
export default function AdminsManager() {
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ username: '', display_name: '', password: '', full_access: true });

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
      setForm({ username: '', display_name: '', password: '', full_access: true });
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
                {a.role === 'owner' && <span className="ms-2 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">المالك</span>}
                {!a.is_active && <span className="ms-2 rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold text-danger">معطّل</span>}
              </p>
              <p className="text-xs text-muted" dir="ltr">@{a.username}</p>
            </div>
            {a.role !== 'owner' && (
              <>
                <label className="flex min-h-11 items-center gap-1.5 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={a.full_access}
                    onChange={(e) => update(a.id, { full_access: e.target.checked }, `fa:${a.id}`)}
                    className="h-4 w-4 accent-accent"
                  />
                  صلاحية كاملة
                </label>
                <button
                  onClick={() => update(a.id, { is_active: !a.is_active }, `act:${a.id}`)}
                  disabled={busy !== null}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-fg transition hover:bg-surface2"
                >
                  {a.is_active ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}
                  {a.is_active ? 'تعطيل' : 'تفعيل'}
                </button>
              </>
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
            <input
              type="checkbox"
              checked={form.full_access}
              onChange={(e) => setForm({ ...form, full_access: e.target.checked })}
              className="h-4 w-4 accent-accent"
            />
            صلاحية كاملة (مساوٍ للمالك عملياً)
          </label>
          <button
            onClick={create}
            disabled={busy !== null || !form.username || form.password.length < 10}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-black shadow-glow transition hover:brightness-110 disabled:opacity-50"
          >
            {busy === 'create' ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} إنشاء الحساب
          </button>
        </div>
      </div>
      {msg && <p className={`text-sm ${msg.startsWith('خطأ') ? 'text-danger' : 'text-success'}`}>{msg}</p>}
    </div>
  );
}
