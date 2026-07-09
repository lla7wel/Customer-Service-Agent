'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, ShieldAlert, Sparkles } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
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
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push('/dashboard');
        router.refresh();
        return;
      }
      if (data?.error === 'auth_not_configured') setNotConfigured(true);
      else setErr(data?.error === 'invalid_credentials' ? 'Invalid email or password.' : data?.error || 'Sign-in failed.');
    } catch {
      setErr('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="premium-shell login-scene relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 cc-grid opacity-50" />
      <div className="login-orb login-orb--a" />
      <div className="login-orb login-orb--b" />
      <div className="login-card3d relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="login-logo3d inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent-grad text-base font-bold text-black shadow-glow">EH</span>
          <h1 className="mt-3 text-lg font-semibold tracking-tight text-fg">English Home Libya</h1>
          <p className="flex items-center gap-1 text-xs uppercase tracking-wider text-accent"><Sparkles size={12} /> Operations Command Center</p>
        </div>

        <div className="command-surface p-6">
          {notConfigured ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
              <p className="flex items-center gap-2 font-medium"><ShieldAlert size={16} /> Auth not configured</p>
              <p className="mt-2 text-xs text-muted">
                Set <span className="font-mono text-fg">ADMIN_EMAIL</span>,{' '}
                <span className="font-mono text-fg">ADMIN_PASSWORD_HASH</span> and{' '}
                <span className="font-mono text-fg">SESSION_SECRET</span> in the server environment. You can still{' '}
                <a className="text-accent underline" href="/dashboard">open the dashboard</a>.
              </p>
            </div>
          ) : (
            <form onSubmit={signIn} className="space-y-3">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="input" />
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="input" />
              {err && <p className="text-xs text-danger">{err}</p>}
              <button type="submit" disabled={busy} className="btn-primary w-full">
                <LogIn size={16} /> {busy ? '…' : 'Sign in'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
