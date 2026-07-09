'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Drop into any server-rendered page to make it feel live: it re-fetches the
 * server component on an interval (and when the tab regains focus) so the admin
 * doesn't have to refresh manually. Pauses while the tab is hidden.
 */
export default function AutoRefresh({ intervalMs = 10000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => { if (!document.hidden) router.refresh(); };
    const id = setInterval(tick, intervalMs);
    const onVisible = () => { if (!document.hidden) router.refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [router, intervalMs]);
  return null;
}
