'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser Supabase client (RLS-bound, anon key). Returns null when not
 * configured so client components can show a "not connected" state.
 */
export function getBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createBrowserClient(url, anon);
}
