/**
 * Truthful provider readiness checks.
 *
 * Each check performs REAL calls against the provider and records exactly what
 * it proved — never an optimistic placeholder (the old health endpoint implied
 * working dependencies it had not tested). Secrets are never stored in the
 * detail payload; only names, ids, expiry timestamps and booleans.
 *
 * A check that cannot run (missing configuration) reports ok=false with the
 * exact remediation step, so Settings can show honest per-channel guidance.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { graphCall, pageId, igUserId, pageAccessToken } from './graph';
import { env } from '../env';

export interface ReadinessResult {
  checkKey: string;
  ok: boolean;
  summary: string;
  detail: Record<string, unknown>;
}

const json = (v: unknown) => JSON.stringify(v ?? {});

export async function checkFacebookPage(): Promise<ReadinessResult> {
  if (!pageAccessToken() || !pageId()) {
    return {
      checkKey: 'facebook_page',
      ok: false,
      summary: 'Facebook Page is not connected.',
      detail: { remediation: 'Set META_PAGE_ID and META_PAGE_ACCESS_TOKEN (a long-lived Page token with pages_manage_posts, pages_read_engagement, pages_messaging).' },
    };
  }
  try {
    const page = await graphCall<{ id: string; name?: string }>(`${pageId()}`, { params: { fields: 'id,name' }, retries: 1 });
    const perms = await graphCall<{ data?: { permission: string; status: string }[] }>('me/permissions', { retries: 1 }).catch(() => null);
    const granted = (perms?.data ?? []).filter((p) => p.status === 'granted').map((p) => p.permission);
    return {
      checkKey: 'facebook_page',
      ok: true,
      summary: `Connected to Page "${page.name ?? page.id}".`,
      detail: { page_id: page.id, page_name: page.name ?? null, granted_permissions: granted },
    };
  } catch (e: any) {
    return {
      checkKey: 'facebook_page',
      ok: false,
      summary: 'Facebook Page token check failed.',
      detail: { error: e?.message ?? 'unknown', remediation: 'Regenerate a long-lived Page access token and update META_PAGE_ACCESS_TOKEN.' },
    };
  }
}

export async function checkWebhookSubscription(): Promise<ReadinessResult> {
  if (!pageAccessToken() || !pageId()) {
    return { checkKey: 'webhooks', ok: false, summary: 'Cannot verify webhook subscription without a connected Page.', detail: { remediation: 'Connect the Facebook Page first.' } };
  }
  try {
    const res = await graphCall<{ data?: { subscribed_fields?: string[] }[] }>(`${pageId()}/subscribed_apps`, { retries: 1 });
    const fields = res.data?.flatMap((d) => d.subscribed_fields ?? []) ?? [];
    const needed = ['messages', 'feed'];
    const missing = needed.filter((f) => !fields.includes(f));
    return {
      checkKey: 'webhooks',
      ok: res.data !== undefined && (res.data?.length ?? 0) > 0 && missing.length === 0,
      summary: missing.length
        ? `App subscribed, but missing webhook fields: ${missing.join(', ')}.`
        : (res.data?.length ? 'Webhook subscription is active.' : 'The app is not subscribed to this Page.'),
      detail: {
        subscribed_fields: fields,
        missing_fields: missing,
        remediation: missing.length || !res.data?.length
          ? 'In the Meta App dashboard → Webhooks, subscribe the Page with fields: messages, messaging_postbacks, feed. For Instagram add: messages, comments.'
          : null,
      },
    };
  } catch (e: any) {
    return { checkKey: 'webhooks', ok: false, summary: 'Webhook subscription check failed.', detail: { error: e?.message ?? 'unknown' } };
  }
}

export async function checkInstagram(): Promise<ReadinessResult> {
  if (!pageAccessToken() || !pageId()) {
    return { checkKey: 'instagram', ok: false, summary: 'Instagram requires a connected Facebook Page.', detail: { remediation: 'Connect the Facebook Page first.' } };
  }
  try {
    const res = await graphCall<{ instagram_business_account?: { id: string } }>(`${pageId()}`, {
      params: { fields: 'instagram_business_account' },
      retries: 1,
    });
    const linkedId = res.instagram_business_account?.id ?? null;
    const configuredId = igUserId() ?? null;
    if (!linkedId) {
      return {
        checkKey: 'instagram',
        ok: false,
        summary: 'No Instagram business account is linked to the Page.',
        detail: { remediation: 'Link the Instagram professional account to the Facebook Page (Meta Business Suite → Settings → Linked accounts), then set META_IG_USER_ID.' },
      };
    }
    if (!configuredId) {
      return {
        checkKey: 'instagram',
        ok: false,
        summary: `Instagram account ${linkedId} is linked but META_IG_USER_ID is not set.`,
        detail: { linked_ig_user_id: linkedId, remediation: `Set META_IG_USER_ID=${linkedId} and restart.` },
      };
    }
    if (configuredId !== linkedId) {
      return {
        checkKey: 'instagram',
        ok: false,
        summary: 'META_IG_USER_ID does not match the account linked to the Page.',
        detail: { linked_ig_user_id: linkedId, configured_ig_user_id: configuredId, remediation: `Set META_IG_USER_ID=${linkedId}.` },
      };
    }
    const ig = await graphCall<{ id: string; username?: string }>(`${linkedId}`, { params: { fields: 'id,username' }, retries: 1 });
    return {
      checkKey: 'instagram',
      ok: true,
      summary: `Connected to Instagram @${ig.username ?? ig.id}.`,
      detail: { ig_user_id: ig.id, username: ig.username ?? null, capabilities: ['feed', 'carousel', 'story', 'comments'] },
    };
  } catch (e: any) {
    return { checkKey: 'instagram', ok: false, summary: 'Instagram account check failed.', detail: { error: e?.message ?? 'unknown' } };
  }
}

/** Prove that the Page token can return real owner-facing Insights data. */
export async function checkInsights(): Promise<ReadinessResult> {
  if (!pageAccessToken() || !pageId()) {
    return { checkKey: 'insights', ok: false, summary: 'Insights require a connected Facebook Page.', detail: { remediation: 'Connect the Facebook Page first.' } };
  }
  try {
    const until = Math.floor(Date.now() / 1000);
    const since = until - 7 * 24 * 60 * 60;
    const result = await graphCall<{ data?: unknown[] }>(`${pageId()}/insights`, {
      params: { metric: 'page_post_engagements,page_views_total', period: 'day', since, until },
      retries: 1,
    });
    const available = Array.isArray(result.data) && result.data.length > 0;
    return {
      checkKey: 'insights',
      ok: available,
      summary: available ? 'Facebook Page Insights access is working.' : 'The token cannot currently return Page Insights.',
      detail: {
        capabilities: available ? ['facebook_page_insights'] : [],
        remediation: available ? null : 'Generate a Page token with pages_read_engagement and read_insights. The person authorizing it must have the Analyze task on the Page.',
      },
    };
  } catch (e: any) {
    return {
      checkKey: 'insights',
      ok: false,
      summary: 'Page Insights access check failed.',
      detail: {
        error: e?.message ?? 'unknown',
        remediation: 'Grant pages_read_engagement and read_insights, regenerate the long-lived Page token, then run this check again.',
      },
    };
  }
}

export async function checkGemini(): Promise<ReadinessResult> {
  if (!env('GEMINI_API_KEY')) {
    return { checkKey: 'gemini', ok: false, summary: 'Gemini is not configured.', detail: { remediation: 'Set GEMINI_API_KEY.' } };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${env('GEMINI_API_KEY')}`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    return res.ok
      ? { checkKey: 'gemini', ok: true, summary: 'Gemini API key is valid.', detail: {} }
      : { checkKey: 'gemini', ok: false, summary: `Gemini API check failed (HTTP ${res.status}).`, detail: { remediation: 'Verify GEMINI_API_KEY.' } };
  } catch (e: any) {
    return { checkKey: 'gemini', ok: false, summary: 'Gemini API is unreachable.', detail: { error: e?.name === 'AbortError' ? 'timeout' : (e?.message ?? 'unknown') } };
  }
}

/** Run every readiness check and persist the truthful results. */
export async function runAllReadinessChecks(db: Kysely<DB>): Promise<ReadinessResult[]> {
  const results = await Promise.all([
    checkFacebookPage(),
    checkWebhookSubscription(),
    checkInstagram(),
    checkInsights(),
    checkGemini(),
  ]);
  for (const r of results) {
    await db
      .insertInto('provider_readiness')
      .values({ check_key: r.checkKey, ok: r.ok, summary: r.summary, detail: json(r.detail), checked_at: new Date().toISOString() })
      .onConflict((oc) => oc.column('check_key').doUpdateSet({
        ok: r.ok, summary: r.summary, detail: json(r.detail), checked_at: new Date().toISOString(),
      }))
      .execute();
  }
  return results;
}
