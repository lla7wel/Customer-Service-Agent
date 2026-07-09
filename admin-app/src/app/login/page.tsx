'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, ShieldAlert, Sparkles } from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabase/browser';

export default function LoginPage() {
  const router = useRouter();
  const supabase = getBrowserSupabase();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr(error.message);
    else router.push('/dashboard');
  }

  return (
    <div className="premium-shell relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 cc-grid opacity-50" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent-grad text-base font-bold text-black shadow-glow">EH</span>
          <h1 className="mt-3 text-lg font-semibold tracking-tight text-fg">English Home Libya</h1>
          <p className="flex items-center gap-1 text-xs uppercase tracking-wider text-accent"><Sparkles size={12} /> Operations Command Center</p>
        </div>

        <div className="command-surface p-6">
          {!supabase ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
              <p className="flex items-center gap-2 font-medium"><ShieldAlert size={16} /> Supabase not connected</p>
              <p className="mt-2 text-xs text-muted">
                Set <span className="font-mono text-fg">NEXT_PUBLIC_SUPABASE_URL</span> and{' '}
                <span className="font-mono text-fg">NEXT_PUBLIC_SUPABASE_ANON_KEY</span>, run{' '}
                <span className="font-mono text-fg">database/schema.sql</span>, create an admin user (docs/SETUP.md). You can still{' '}
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
