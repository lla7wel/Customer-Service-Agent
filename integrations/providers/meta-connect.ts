/**
 * Meta connection lifecycle: OAuth exchange, Page/Instagram discovery, and
 * webhook subscription repair — all through the hardened Graph client (no tokens
 * in URLs, structured errors, timeouts).
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { graphCall, graphBase, graphVersion, metaAppId, pageAccessToken, pageId, igUserId } from './graph';
import { env, envAny } from '../env';
import { saveMetaConnection, resolveMetaCredentials } from './connection';

/** Permissions this application actually needs (current Graph names). */
export const REQUIRED_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_manage_posts',
  'pages_read_engagement',
  'read_insights',
  'instagram_basic',
  'instagram_manage_messages',
  'instagram_manage_comments',
  'instagram_content_publish',
  'business_management',
];

/** Required webhook fields — merged with, never replacing, existing ones. */
export const REQUIRED_PAGE_FIELDS = ['messages', 'messaging_postbacks', 'feed'];
export const REQUIRED_IG_FIELDS = ['messages', 'messaging_postbacks', 'comments', 'mentions'];

export const OAUTH_REDIRECT_PATH = '/api/settings/channels/meta/callback';
export const WEBHOOK_PATH = '/api/meta/webhook';

/** Merge required fields into the current set, preserving any extra fields Meta
 *  already has subscribed (never narrow a working subscription). Pure/testable. */
export function mergeSubscriptionFields(current: string[], required: string[]): { merged: string[]; missing: string[] } {
  const set = new Set(current.map((f) => f.trim()).filter(Boolean));
  const missing = required.filter((f) => !set.has(f));
  for (const f of required) set.add(f);
  return { merged: [...set].sort(), missing };
}

export function appBaseUrl(): string {
  return (envAny('APP_BASE_URL', 'PUBLIC_BASE_URL') || 'https://app.ehlibya.com').replace(/\/$/, '');
}

/** The Facebook Login dialog URL (owner-only start endpoint builds this). */
export function buildOAuthUrl(state: string): string | null {
  const appId = metaAppId();
  if (!appId) return null;
  const redirect = appBaseUrl() + OAUTH_REDIRECT_PATH;
  const qs = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirect,
    state,
    response_type: 'code',
    scope: REQUIRED_SCOPES.join(','),
  });
  return `https://www.facebook.com/${graphVersion()}/dialog/oauth?${qs.toString()}`;
}

/** Exchange an OAuth code for a user access token (server-side; secret in body). */
export async function exchangeCodeForToken(code: string): Promise<{ access_token: string; expires_in?: number }> {
  const appId = metaAppId();
  const appSecret = env('META_APP_SECRET');
  if (!appId || !appSecret) throw new Error('META_APP_ID / META_APP_SECRET are required for the OAuth exchange.');
  const redirect = appBaseUrl() + OAUTH_REDIRECT_PATH;
  // Token exchange is a GET on the oauth endpoint; the app secret goes in the
  // query params (server-to-server), never a URL the browser sees.
  return graphCall(`oauth/access_token`, {
    method: 'GET',
    accessToken: appSecret, // bearer is ignored by the oauth endpoint; client_secret param is authoritative
    params: { client_id: appId, redirect_uri: redirect, client_secret: appSecret, code },
  });
}

/** Extend a short-lived user token to a long-lived one (best effort). */
export async function longLivedToken(shortToken: string): Promise<{ access_token: string; expires_in?: number } | null> {
  const appId = metaAppId();
  const appSecret = env('META_APP_SECRET');
  if (!appId || !appSecret) return null;
  return graphCall(`oauth/access_token`, {
    method: 'GET',
    accessToken: appSecret,
    params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken },
  }).catch(() => null);
}

export interface DiscoveredConnection {
  userAccessToken: string;
  tokenExpiresAt: string | null;
  grantedScopes: string[];
  appId: string | null;
  pages: { id: string; name: string; accessToken: string; igUserId: string | null; igUsername: string | null }[];
}

/** Given a long-lived user token, discover the Pages + linked IG accounts. */
export async function discoverConnection(userAccessToken: string): Promise<DiscoveredConnection> {
  const [me, perms, accounts] = await Promise.all([
    graphCall<{ id?: string }>('me', { accessToken: userAccessToken, params: { fields: 'id' } }).catch(() => ({})),
    graphCall<{ data?: { permission: string; status: string }[] }>('me/permissions', { accessToken: userAccessToken }).catch(() => ({ data: [] })),
    graphCall<{ data?: any[] }>('me/accounts', {
      accessToken: userAccessToken,
      params: { fields: 'id,name,access_token,instagram_business_account{id,username}' },
    }).catch(() => ({ data: [] })),
  ]);
  void me;
  const grantedScopes = (perms.data ?? []).filter((p) => p.status === 'granted').map((p) => p.permission);
  const pages = (accounts.data ?? []).map((p) => ({
    id: String(p.id),
    name: String(p.name ?? ''),
    accessToken: String(p.access_token ?? ''),
    igUserId: p.instagram_business_account?.id ? String(p.instagram_business_account.id) : null,
    igUsername: p.instagram_business_account?.username ? String(p.instagram_business_account.username) : null,
  }));
  return { userAccessToken, tokenExpiresAt: null, grantedScopes, appId: metaAppId() ?? null, pages };
}

/* --------------------------- subscription repair -------------------------- */

/** Read the Page's currently subscribed webhook fields for THIS app. */
export async function readPageSubscribedFields(pgId: string, pageToken: string): Promise<string[]> {
  const res = await graphCall<{ data?: { subscribed_fields?: string[] }[] }>(`${pgId}/subscribed_apps`, { accessToken: pageToken }).catch(() => ({ data: [] }));
  const app = (res.data ?? [])[0];
  return app?.subscribed_fields ?? [];
}

/** Subscribe the Page to a set of fields (merged; POST, no token in URL). */
export async function subscribePageFields(pgId: string, pageToken: string, fields: string[]): Promise<void> {
  await graphCall(`${pgId}/subscribed_apps`, {
    method: 'POST',
    accessToken: pageToken,
    params: { subscribed_fields: fields.join(',') },
    retries: 0,
  });
}

/** Read the Instagram professional account's subscribed fields for THIS app. */
export async function readInstagramSubscribedFields(ig: string, pageToken: string): Promise<string[]> {
  const res = await graphCall<{ data?: { subscribed_fields?: string[] }[] }>(`${ig}/subscribed_apps`, { accessToken: pageToken }).catch(() => ({ data: [] }));
  const app = (res.data ?? [])[0];
  return app?.subscribed_fields ?? [];
}

/** Subscribe the Instagram professional account (via the Page token). */
export async function subscribeInstagramFields(ig: string, pageToken: string, fields: string[]): Promise<void> {
  await graphCall(`${ig}/subscribed_apps`, {
    method: 'POST',
    accessToken: pageToken,
    params: { subscribed_fields: fields.join(',') },
    retries: 0,
  });
}

export interface SubscriptionRepairResult {
  page: { before: string[]; after: string[]; missing: string[]; ok: boolean };
  instagram: { before: string[]; after: string[]; missing: string[]; ok: boolean } | null;
  error?: string;
}

/**
 * Fetch existing subscriptions, merge in the required fields (never narrowing),
 * subscribe, then READ BACK to verify. Stores the verified fields.
 */
export async function repairSubscriptions(db: Kysely<DB>): Promise<SubscriptionRepairResult> {
  const creds = await resolveMetaCredentials(db);
  if (!creds.pageAccessToken || !creds.pageId) {
    return { page: { before: [], after: [], missing: REQUIRED_PAGE_FIELDS, ok: false }, instagram: null, error: 'not_configured' };
  }
  const token = creds.pageAccessToken;

  const pageBefore = await readPageSubscribedFields(creds.pageId, token);
  const { merged: pageMerge, missing: pageMissing } = mergeSubscriptionFields(pageBefore, REQUIRED_PAGE_FIELDS);
  if (pageMissing.length) await subscribePageFields(creds.pageId, token, pageMerge);
  const pageAfter = await readPageSubscribedFields(creds.pageId, token);
  const pageOk = REQUIRED_PAGE_FIELDS.every((f) => pageAfter.includes(f));

  let instagram: SubscriptionRepairResult['instagram'] = null;
  if (creds.igUserId) {
    const igBefore = await readInstagramSubscribedFields(creds.igUserId, token);
    const { merged: igMerge, missing: igMissing } = mergeSubscriptionFields(igBefore, REQUIRED_IG_FIELDS);
    if (igMissing.length) await subscribeInstagramFields(creds.igUserId, token, igMerge).catch(() => {});
    const igAfter = await readInstagramSubscribedFields(creds.igUserId, token);
    instagram = { before: igBefore, after: igAfter, missing: REQUIRED_IG_FIELDS.filter((f) => !igAfter.includes(f)), ok: REQUIRED_IG_FIELDS.every((f) => igAfter.includes(f)) };
  }

  await saveMetaConnection(db, {
    pageSubscribedFields: pageAfter,
    igSubscribedFields: instagram?.after ?? [],
  }).catch(() => {});

  return {
    page: { before: pageBefore, after: pageAfter, missing: REQUIRED_PAGE_FIELDS.filter((f) => !pageAfter.includes(f)), ok: pageOk },
    instagram,
  };
}

/** Validate the current Page token by reading the Page identity. */
export async function validatePageToken(db: Kysely<DB>): Promise<{ ok: boolean; pageId?: string; name?: string; error?: string }> {
  const creds = await resolveMetaCredentials(db);
  if (!creds.pageAccessToken || !creds.pageId) return { ok: false, error: 'not_configured' };
  try {
    const res = await graphCall<{ id?: string; name?: string }>(`${creds.pageId}`, { accessToken: creds.pageAccessToken, params: { fields: 'id,name' } });
    return { ok: Boolean(res.id), pageId: res.id, name: res.name };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'validation_failed' };
  }
}

void graphBase; void pageAccessToken; void pageId; void igUserId;
