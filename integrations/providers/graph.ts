/**
 * Hardened Meta Graph API client shared by every provider adapter.
 *
 *   * every request has a hard timeout (no bare fetch — EH-031);
 *   * transient failures (429/5xx/network) retry with bounded backoff and
 *     honor Retry-After; permanent errors surface immediately;
 *   * the access token travels in the POST body / Authorization header — never
 *     in the URL, so it can never leak into logs;
 *   * responses are parsed defensively; error payloads keep Meta's code and
 *     subcode so operators see actionable states, not generic "failed".
 */
import { env, envAny } from '../env';

export class MetaApiError extends Error {
  status: number;
  code: number | null;
  subcode: number | null;
  transient: boolean;
  fbtraceId: string | null;

  constructor(message: string, opts: { status: number; code?: number | null; subcode?: number | null; transient?: boolean; fbtraceId?: string | null }) {
    super(message);
    this.name = 'MetaApiError';
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.subcode = opts.subcode ?? null;
    this.transient = opts.transient ?? false;
    this.fbtraceId = opts.fbtraceId ?? null;
  }
}

export function graphVersion(): string {
  return envAny('META_GRAPH_VERSION') || 'v21.0';
}

export function graphBase(): string {
  return `https://graph.facebook.com/${graphVersion()}`;
}

export function pageAccessToken(): string | undefined {
  return env('META_PAGE_ACCESS_TOKEN');
}

export function pageId(): string | undefined {
  return env('META_PAGE_ID');
}

export function igUserId(): string | undefined {
  return env('META_IG_USER_ID');
}

export interface GraphCallOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  /** Body params (POST) or query params (GET). Token is added automatically. */
  params?: Record<string, unknown>;
  timeoutMs?: number;
  /** Retries for TRANSIENT failures only. Non-idempotent sends should pass 0. */
  retries?: number;
  accessToken?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Meta error codes that are known-transient (rate limits / temporary). */
const TRANSIENT_META_CODES = new Set([1, 2, 4, 17, 32, 613]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function graphCall<T = any>(path: string, opts: GraphCallOptions = {}): Promise<T> {
  const token = opts.accessToken ?? pageAccessToken();
  if (!token) {
    throw new MetaApiError('Meta is not configured (META_PAGE_ACCESS_TOKEN missing).', { status: 0, transient: false });
  }
  const method = opts.method ?? 'GET';
  const retries = opts.retries ?? (method === 'GET' ? 2 : 0);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: MetaApiError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(8000, 500 * 2 ** attempt));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let url = `${graphBase()}/${path.replace(/^\//, '')}`;
      let body: string | undefined;
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      if (method === 'GET' || method === 'DELETE') {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(opts.params ?? {})) {
          if (v !== undefined && v !== null) qs.set(k, String(v));
        }
        const q = qs.toString();
        if (q) url += (url.includes('?') ? '&' : '?') + q;
      } else {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(opts.params ?? {});
      }

      const res = await fetch(url, { method, headers, body, signal: controller.signal });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok) return data as T;

      const err = data?.error ?? {};
      const transient = isTransientStatus(res.status) || TRANSIENT_META_CODES.has(Number(err.code));
      const apiError = new MetaApiError(
        err.message || `Meta Graph HTTP ${res.status}`,
        { status: res.status, code: err.code ?? null, subcode: err.error_subcode ?? null, transient, fbtraceId: err.fbtrace_id ?? null },
      );
      if (!transient || attempt === retries) throw apiError;
      lastError = apiError;
      const retryAfter = Number(res.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) await sleep(Math.min(30_000, retryAfter * 1000));
    } catch (e: any) {
      if (e instanceof MetaApiError) {
        if (!e.transient || attempt === retries) throw e;
        lastError = e;
        continue;
      }
      // Network failure / timeout — transient by definition.
      const aborted = e?.name === 'AbortError';
      const netError = new MetaApiError(
        aborted ? `Meta Graph request timed out after ${timeoutMs}ms` : (e?.message ?? 'network error'),
        { status: 0, transient: true },
      );
      if (attempt === retries) throw netError;
      lastError = netError;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new MetaApiError('Meta Graph request failed', { status: 0, transient: true });
}
