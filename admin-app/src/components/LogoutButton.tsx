'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

/** Ends the admin session and returns to the login screen. */
export default function LogoutButton({ label }: { label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      title={label}
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-danger/10 hover:text-danger disabled:opacity-50"
    >
      <LogOut size={15} />
    </button>
  );
}
