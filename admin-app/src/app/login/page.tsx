'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, ShieldAlert } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push(typeof data?.redirect === 'string' ? data.redirect : '/dashboard');
        router.refresh();
        return;
      }
      if (data?.error === 'auth_not_configured') setNotConfigured(true);
      else if (data?.error === 'rate_limited') setErr('محاولات كثيرة — جرّب بعد شوية.');
      else setErr(data?.error === 'invalid_credentials' ? 'اسم المستخدم أو كلمة المرور غير صحيحة.' : data?.detail || data?.error || 'تعذّر تسجيل الدخول.');
    } catch {
      setErr('خطأ في الاتصال — حاول مرة ثانية.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="premium-shell relative flex min-h-screen items-center justify-center p-4">
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-navy text-base font-bold text-white">EH</span>
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-fg">English Home Libya</h1>
          <p className="mt-1 text-xs uppercase tracking-[.18em] text-muted">Operations Center</p>
        </div>

        <div className="command-surface p-6">
          {notConfigured ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
              <p className="flex items-center gap-2 font-medium"><ShieldAlert size={16} /> Authentication is not configured</p>
              <p className="mt-2 text-xs text-muted">
                Set <span className="font-mono text-fg">SESSION_SECRET</span> in the server environment, then create the
                first owner account with <span className="font-mono text-fg">npm run bootstrap:owner</span> (see the README).
                The app refuses to serve the dashboard until this is done.
              </p>
            </div>
          ) : (
            <form onSubmit={signIn} className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">اسم المستخدم</span>
                <input
                  type="text" required autoComplete="username" dir="ltr"
                  value={username} onChange={(e) => setUsername(e.target.value)}
                  placeholder="username" className="input min-h-11"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">كلمة المرور</span>
                <input
                  type="password" required autoComplete="current-password" dir="ltr"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" className="input min-h-11"
                />
              </label>
              {err && <p className="text-xs text-danger" dir="auto">{err}</p>}
              <button type="submit" disabled={busy} className="btn-primary min-h-11 w-full">
                <LogIn size={16} /> {busy ? '…' : 'دخول'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
