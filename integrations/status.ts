import { envAny } from './env';

/**
 * Feature-detection for every integration. The whole "not connected" UX is
 * built on this: if `configured` is false, the UI shows a setup card and server
 * endpoints return 503 — nothing is ever faked.
 */
export type IntegrationKey = 'supabase' | 'gemini' | 'meta' | 'cloudflare';

export interface IntegrationStatus {
  key: IntegrationKey;
  label: string;
  configured: boolean;
  /** Env vars that are required but currently missing. */
  missing: string[];
  /** Short hint shown in the UI. */
  hint: string;
}

export function supabaseStatus(): IntegrationStatus {
  const url = envAny('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
  const anon = envAny('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');
  const missing: string[] = [];
  if (!url) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!anon) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return {
    key: 'supabase',
    label: 'Supabase',
    configured: missing.length === 0,
    missing,
    hint: 'Database, auth and storage. Run database/schema.sql, then add the API keys.',
  };
}

export function geminiStatus(): IntegrationStatus {
  const key = envAny('GEMINI_API_KEY');
  return {
    key: 'gemini',
    label: 'Gemini AI',
    configured: !!key,
    missing: key ? [] : ['GEMINI_API_KEY'],
    hint: 'The only AI provider (chat, intent, vision, captions, image edits).',
  };
}

export function metaStatus(): IntegrationStatus {
  const checks: Array<[string, string | undefined]> = [
    ['META_PAGE_ID', envAny('META_PAGE_ID')],
    ['META_PAGE_ACCESS_TOKEN', envAny('META_PAGE_ACCESS_TOKEN')],
    ['META_VERIFY_TOKEN', envAny('META_VERIFY_TOKEN')],
    ['META_APP_SECRET', envAny('META_APP_SECRET')],
  ];
  const missing = checks.filter(([, v]) => !v).map(([k]) => k);
  return {
    key: 'meta',
    label: 'Meta / Facebook',
    configured: missing.length === 0,
    missing,
    hint: 'Messenger DMs and page posting.',
  };
}

export function cloudflareStatus(): IntegrationStatus {
  const secret = envAny('CLOUDFLARE_WEBHOOK_SECRET');
  return {
    key: 'cloudflare',
    label: 'Workers / Cron',
    configured: !!secret,
    missing: secret ? [] : ['CLOUDFLARE_WEBHOOK_SECRET'],
    hint: 'Optional: move webhooks/cron off the Next.js app (campaign scheduler).',
  };
}

export function allIntegrationStatuses(): IntegrationStatus[] {
  return [supabaseStatus(), geminiStatus(), metaStatus(), cloudflareStatus()];
}

/** The public base URL of the deployed app (used for Meta webhook callbacks). */
export function appBaseUrl(): string | undefined {
  return envAny('APP_BASE_URL', 'NEXT_PUBLIC_APP_BASE_URL', 'NEXT_PUBLIC_APP_URL');
}

/** Unified webhook callback URL Meta needs. Returns a relative path if base URL unset. */
export function webhookUrls(): { url: string; baseUrlSet: boolean } {
  const base = appBaseUrl();
  const baseUrlSet = !!base;
  const root = base ? base.replace(/\/+$/, '') : '';
  return {
    url: `${root}/api/meta/webhook`,
    baseUrlSet,
  };
}
