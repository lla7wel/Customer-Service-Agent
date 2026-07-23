/**
 * The ONE Meta connection resolver.
 *
 * Runtime credentials come from the encrypted `provider_connections` row
 * (authoritative) with the META_* environment as a migration fallback. Both the
 * app and the worker call `primeMetaFromDb(db)` so they resolve the identical
 * connection; the public webhook resolves its verify token / app secret the same
 * way and never depends on browser state.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { env, envAny } from '../env';
import { encryptSecret, decryptSecret, maskTail, isEncryptionConfigured } from './secret-crypto';
import { primeMetaCredentials, type ResolvedMetaCredentials } from './graph';

export interface MetaConnectionMeta {
  configured: boolean;
  source: 'env' | 'oauth' | 'manual' | 'none';
  appId: string | null;
  pageId: string | null;
  pageName: string | null;
  igUserId: string | null;
  igUsername: string | null;
  grantedScopes: string[];
  tokenExpiresAt: string | null;
  pageTokenTail: string | null;
  pageSubscribedFields: string[];
  igSubscribedFields: string[];
  status: string;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  lastWebhookAt: string | null;
  hasPageToken: boolean;
  hasAppSecret: boolean;
  hasVerifyToken: boolean;
}

/** Resolve plaintext credentials (DB-first, env fallback). Secrets stay in memory. */
export async function resolveMetaCredentials(db: Kysely<DB>): Promise<ResolvedMetaCredentials> {
  const row = await db.selectFrom('provider_connections').selectAll().where('id', '=', 1).executeTakeFirst().catch(() => null);
  return {
    pageAccessToken: (row && decryptSecret(row.page_access_token_enc)) || env('META_PAGE_ACCESS_TOKEN') || undefined,
    pageId: row?.page_id || env('META_PAGE_ID') || undefined,
    igUserId: row?.ig_user_id || env('META_IG_USER_ID') || undefined,
    appSecret: (row && decryptSecret(row.app_secret_enc)) || env('META_APP_SECRET') || undefined,
    verifyToken: (row && decryptSecret(row.verify_token_enc)) || env('META_VERIFY_TOKEN') || undefined,
    appId: row?.app_id || envAny('META_APP_ID', 'FACEBOOK_APP_ID') || undefined,
  };
}

/** Resolve and prime the process credential cache used by every Graph call. */
export async function primeMetaFromDb(db: Kysely<DB>): Promise<ResolvedMetaCredentials> {
  const creds = await resolveMetaCredentials(db);
  primeMetaCredentials(creds);
  return creds;
}

/** Safe, secret-free metadata for the Channels UI and readiness. */
export async function getMetaConnectionMeta(db: Kysely<DB>): Promise<MetaConnectionMeta> {
  const row = await db.selectFrom('provider_connections').selectAll().where('id', '=', 1).executeTakeFirst().catch(() => null);
  const creds = await resolveMetaCredentials(db);
  return {
    configured: Boolean(creds.pageAccessToken && creds.pageId),
    source: (row?.source as MetaConnectionMeta['source']) ?? (creds.pageAccessToken ? 'env' : 'none'),
    appId: creds.appId ?? null,
    pageId: creds.pageId ?? null,
    pageName: row?.page_name ?? null,
    igUserId: creds.igUserId ?? null,
    igUsername: row?.ig_username ?? null,
    grantedScopes: row?.granted_scopes ?? [],
    tokenExpiresAt: row?.token_expires_at ? new Date(row.token_expires_at as any).toISOString() : null,
    pageTokenTail: row?.page_token_tail ?? (creds.pageAccessToken ? maskTail(creds.pageAccessToken) : null),
    pageSubscribedFields: row?.page_subscribed_fields ?? [],
    igSubscribedFields: row?.ig_subscribed_fields ?? [],
    status: row?.status ?? (creds.pageAccessToken ? 'env' : 'disconnected'),
    connectedAt: row?.connected_at ? new Date(row.connected_at as any).toISOString() : null,
    lastVerifiedAt: row?.last_verified_at ? new Date(row.last_verified_at as any).toISOString() : null,
    lastWebhookAt: row?.last_webhook_at ? new Date(row.last_webhook_at as any).toISOString() : null,
    hasPageToken: Boolean(creds.pageAccessToken),
    hasAppSecret: Boolean(creds.appSecret),
    hasVerifyToken: Boolean(creds.verifyToken),
  };
}

export interface SaveMetaConnectionInput {
  pageAccessToken?: string | null;
  appSecret?: string | null;
  verifyToken?: string | null;
  userAccessToken?: string | null;
  appId?: string | null;
  pageId?: string | null;
  pageName?: string | null;
  igUserId?: string | null;
  igUsername?: string | null;
  grantedScopes?: string[];
  tokenExpiresAt?: string | null;
  source?: 'oauth' | 'manual' | 'env';
  status?: string;
  pageSubscribedFields?: string[];
  igSubscribedFields?: string[];
}

/**
 * Upsert the singleton connection, encrypting every secret. Fields left
 * undefined are preserved; secrets set to a non-empty string are re-encrypted.
 */
export async function saveMetaConnection(db: Kysely<DB>, input: SaveMetaConnectionInput): Promise<void> {
  if (!isEncryptionConfigured()) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY is not configured — cannot securely store the Meta connection.');
  }
  const now = new Date().toISOString();
  const set: Record<string, unknown> = { updated_at: now };
  if (input.pageAccessToken) { set.page_access_token_enc = encryptSecret(input.pageAccessToken); set.page_token_tail = maskTail(input.pageAccessToken); }
  if (input.appSecret) set.app_secret_enc = encryptSecret(input.appSecret);
  if (input.verifyToken) set.verify_token_enc = encryptSecret(input.verifyToken);
  if (input.userAccessToken) set.user_access_token_enc = encryptSecret(input.userAccessToken);
  if (input.appId !== undefined) set.app_id = input.appId;
  if (input.pageId !== undefined) set.page_id = input.pageId;
  if (input.pageName !== undefined) set.page_name = input.pageName;
  if (input.igUserId !== undefined) set.ig_user_id = input.igUserId;
  if (input.igUsername !== undefined) set.ig_username = input.igUsername;
  if (input.grantedScopes !== undefined) set.granted_scopes = input.grantedScopes;
  if (input.tokenExpiresAt !== undefined) set.token_expires_at = input.tokenExpiresAt;
  if (input.source !== undefined) set.source = input.source;
  if (input.status !== undefined) set.status = input.status;
  if (input.pageSubscribedFields !== undefined) set.page_subscribed_fields = input.pageSubscribedFields;
  if (input.igSubscribedFields !== undefined) set.ig_subscribed_fields = input.igSubscribedFields;
  if (input.status === 'connected' || input.source === 'oauth' || input.source === 'manual') set.connected_at = now;

  const existing = await db.selectFrom('provider_connections').select('id').where('id', '=', 1).executeTakeFirst();
  if (existing) {
    await db.updateTable('provider_connections').set(set as any).where('id', '=', 1).execute();
  } else {
    await db.insertInto('provider_connections').values({ id: 1, provider: 'meta', ...(set as any) }).execute();
  }
  // Refresh the process cache so subsequent calls see the new connection.
  await primeMetaFromDb(db);
}

/**
 * One-time import: if there is no stored connection but valid production META_*
 * env values exist AND encryption is configured, copy them into encrypted
 * storage (source='env') without ever exposing them. Idempotent.
 */
export async function importEnvConnectionOnce(db: Kysely<DB>): Promise<boolean> {
  if (!isEncryptionConfigured()) return false;
  const existing = await db.selectFrom('provider_connections').select('id').where('id', '=', 1).executeTakeFirst().catch(() => null);
  if (existing) return false;
  const pageToken = env('META_PAGE_ACCESS_TOKEN');
  const pageId = env('META_PAGE_ID');
  if (!pageToken || !pageId) return false;
  await saveMetaConnection(db, {
    pageAccessToken: pageToken,
    appSecret: env('META_APP_SECRET') ?? null,
    verifyToken: env('META_VERIFY_TOKEN') ?? null,
    appId: envAny('META_APP_ID', 'FACEBOOK_APP_ID') ?? null,
    pageId,
    igUserId: env('META_IG_USER_ID') ?? null,
    source: 'env',
    status: 'env',
  });
  return true;
}

/** Record a real inbound webhook delivery (freshness for readiness). */
export async function markWebhookReceived(db: Kysely<DB>): Promise<void> {
  await db.updateTable('provider_connections').set({ last_webhook_at: new Date().toISOString() }).where('id', '=', 1).execute().catch(() => {});
}
