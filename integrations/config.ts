/**
 * Central runtime configuration with FAIL-CLOSED validation.
 *
 * Every process (web, worker, scripts) validates its required configuration at
 * boot through `validateConfig()` / `assertConfig()`. A production process with
 * missing security-critical configuration must refuse to serve traffic instead
 * of silently degrading (the old middleware failed OPEN without SESSION_SECRET
 * — audit finding EH-012).
 *
 * Secrets are never echoed back: validation reports the NAME of a missing or
 * malformed variable, never its value.
 */
import { env } from './env';

export type Runtime = 'web' | 'worker' | 'script';

export interface ConfigReport {
  ok: boolean;
  /** Names of required variables that are missing/empty. */
  missing: string[];
  /** Names of variables present but malformed, with a safe reason. */
  invalid: { name: string; reason: string }[];
  /** Optional integrations that are not configured (informational). */
  notConfigured: string[];
}

const REQUIRED_ALWAYS = ['DATABASE_URL'];
const REQUIRED_WEB = ['SESSION_SECRET'];
/** Optional integration groups: absent = feature shows "not connected". */
const OPTIONAL_GROUPS: Record<string, string[]> = {
  gemini: ['GEMINI_API_KEY'],
  meta: ['META_PAGE_ID', 'META_PAGE_ACCESS_TOKEN', 'META_VERIFY_TOKEN', 'META_APP_SECRET'],
  instagram: ['META_IG_USER_ID'],
  media: ['MEDIA_ROOT', 'PUBLIC_MEDIA_BASE_URL'],
};

export function isProduction(): boolean {
  return (env('NODE_ENV') ?? 'development') === 'production';
}

/** True only when auth is EXPLICITLY disabled for local development. */
export function authExplicitlyDisabled(): boolean {
  return !isProduction() && env('AUTH_DISABLED_DEV') === 'true';
}

export function validateConfig(runtime: Runtime): ConfigReport {
  const missing: string[] = [];
  const invalid: { name: string; reason: string }[] = [];
  const notConfigured: string[] = [];

  for (const name of REQUIRED_ALWAYS) {
    if (!env(name)?.trim()) missing.push(name);
  }
  if (runtime === 'web') {
    for (const name of REQUIRED_WEB) {
      if (!env(name)?.trim() && !authExplicitlyDisabled()) missing.push(name);
    }
    const secret = env('SESSION_SECRET');
    if (secret && secret.trim().length < 32) {
      invalid.push({ name: 'SESSION_SECRET', reason: 'must be at least 32 characters (openssl rand -hex 32)' });
    }
  }

  for (const [group, names] of Object.entries(OPTIONAL_GROUPS)) {
    if (names.some((n) => !env(n)?.trim())) notConfigured.push(group);
  }

  const url = env('DATABASE_URL');
  if (url && !/^postgres(ql)?:\/\//.test(url)) {
    invalid.push({ name: 'DATABASE_URL', reason: 'must be a postgres:// connection string' });
  }

  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid, notConfigured };
}

/** Throws (refusing to boot) when required configuration is absent. */
export function assertConfig(runtime: Runtime): ConfigReport {
  const report = validateConfig(runtime);
  if (!report.ok) {
    const parts = [
      report.missing.length ? `missing: ${report.missing.join(', ')}` : null,
      report.invalid.length ? `invalid: ${report.invalid.map((i) => `${i.name} (${i.reason})`).join('; ')}` : null,
    ].filter(Boolean);
    throw new Error(`Configuration is incomplete for the ${runtime} process — ${parts.join(' | ')}. The process refuses to start (fail-closed).`);
  }
  return report;
}

/** Is a named optional integration fully configured? */
export function integrationConfigured(group: keyof typeof OPTIONAL_GROUPS): boolean {
  return OPTIONAL_GROUPS[group].every((n) => !!env(n)?.trim());
}
