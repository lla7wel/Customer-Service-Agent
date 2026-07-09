import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { envAny } from '../env';
import { supabaseStatus } from '../status';

/**
 * Service-role Supabase client. SERVER / SCRIPTS / WORKERS ONLY.
 * Bypasses RLS. Never import this into client components.
 *
 * Returns null if not configured, so callers can show "not connected".
 */
let cached: SupabaseClient | null = null;

export function adminClient(): SupabaseClient | null {
  const url = envAny('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = envAny('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return null;
  if (cached) return cached;
  cached = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}

/** Throwing variant for scripts that cannot proceed without a DB connection. */
export function requireAdminClient(): SupabaseClient {
  const c = adminClient();
  if (!c) {
    const s = supabaseStatus();
    const missingService = !envAny('SUPABASE_SERVICE_ROLE_KEY')
      ? ['SUPABASE_SERVICE_ROLE_KEY']
      : [];
    throw new Error(
      `Supabase is not configured. Missing: ${[...s.missing, ...missingService].join(', ') ||
        'SUPABASE_SERVICE_ROLE_KEY'}. See docs/ENV.md.`,
    );
  }
  return c;
}

export function storageBucket(): string {
  return envAny('SUPABASE_STORAGE_BUCKET') || 'eh-media';
}
