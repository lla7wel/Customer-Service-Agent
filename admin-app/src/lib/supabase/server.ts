import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { databaseStatus } from '@integrations/status';

/**
 * Cookie-bound Supabase client for Server Components / Route Handlers.
 * Returns null when not configured so callers render "not connected".
 */
export function getServerSupabase() {
  const status = databaseStatus();
  if (!status.configured) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;
  const cookieStore = cookies();

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options as any),
          );
        } catch {
          // set from a Server Component (read-only cookies) — safe to ignore.
        }
      },
    },
  });
}
