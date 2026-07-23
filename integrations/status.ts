import { envAny } from './env';

/**
 * Feature-detection for every integration. The whole "not connected" UX is
 * built on this: if `configured` is false, the UI shows a setup card and server
 * endpoints return 503 — nothing is ever faked.
 */
export type IntegrationKey = 'database' | 'gemini' | 'meta';

export interface IntegrationStatus {
  key: IntegrationKey;
  label: string;
  configured: boolean;
  /** Env vars that are required but currently missing. */
  missing: string[];
  /** Short hint shown in the UI. */
  hint: string;
}

export function databaseStatus(): IntegrationStatus {
  const url = envAny('DATABASE_URL');
  return {
    key: 'database',
    label: 'Database',
    configured: !!url,
    missing: url ? [] : ['DATABASE_URL'],
    hint: 'PostgreSQL connection. Apply database/schema.sql + migrations, then set DATABASE_URL.',
  };
}

/** Where product/content images live and the public base URL they are served from. */
export function mediaStatus(): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!envAny('MEDIA_ROOT')) missing.push('MEDIA_ROOT');
  if (!envAny('PUBLIC_MEDIA_BASE_URL')) missing.push('PUBLIC_MEDIA_BASE_URL');
  return { configured: missing.length === 0, missing };
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
    label: 'Meta channels',
    configured: missing.length === 0,
    missing,
    hint: 'Messenger, Instagram DMs, publishing and comment automation.',
  };
}

export function allIntegrationStatuses(): IntegrationStatus[] {
  // Scheduling is a proven worker-health state, exposed separately by
  // /api/health. It is not an external integration and requires no cron secret.
  return [databaseStatus(), geminiStatus(), metaStatus()];
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
