/**
 * Multi-admin session auth.
 *
 * Accounts live in admin_accounts (bcrypt hashes; the owner bootstraps via
 * scripts/bootstrap-owner.ts and creates the other admins in Settings).
 *
 * Two-layer session model:
 *   1. a signed jose HS256 JWT in an httpOnly cookie (adminId + sessionId) —
 *      verified in middleware via Web Crypto (edge-safe, fail-closed);
 *   2. a DB row in admin_sessions (sha256 of the session id) — checked by
 *      requireAdmin() on every API/data access, so sessions are revocable and
 *      a disabled admin loses access immediately.
 *
 * There are NO env-credential fallbacks and no default passwords.
 */
import { createHash, randomBytes } from 'crypto';
import type { Kysely } from 'kysely';
import type { DB } from '@integrations/db/types';
import { getDb } from '@integrations/db/client';
import {
  SESSION_COOKIE, SESSION_TTL_SECONDS, isAuthConfigured,
  signSessionJwt, verifySessionToken,
} from './auth-edge';

export { SESSION_COOKIE, isAuthConfigured, verifySessionToken };

export interface AdminContext {
  id: string;
  username: string;
  displayName: string | null;
  role: 'owner' | 'admin';
  fullAccess: boolean;
  sessionId: string;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Create a DB-backed session + signed cookie token for an admin. */
export async function createSession(
  db: Kysely<DB>,
  admin: { id: string; username: string },
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<string | null> {
  if (!isAuthConfigured()) return null;
  const sessionId = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await db.insertInto('admin_sessions').values({
    admin_id: admin.id,
    token_hash: sha256(sessionId),
    ip: meta.ip ?? null,
    user_agent: (meta.userAgent ?? '').slice(0, 300) || null,
    expires_at: expiresAt,
  }).execute();
  return signSessionJwt(admin.id, sessionId, admin.username);
}

/**
 * Full authorization check for API routes and server components: verifies the
 * cookie, the DB session (revocation), and the account (is_active).
 */
export async function requireAdmin(cookieValue: string | undefined | null): Promise<AdminContext | null> {
  const parsed = await verifySessionToken(cookieValue);
  if (!parsed) return null;
  const db = getDb();
  if (!db) return null;
  const session = await db
    .selectFrom('admin_sessions')
    .select(['id', 'admin_id', 'expires_at', 'revoked_at'])
    .where('token_hash', '=', sha256(parsed.sessionId))
    .executeTakeFirst();
  if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) return null;
  if (session.admin_id !== parsed.adminId) return null;
  const admin = await db
    .selectFrom('admin_accounts')
    .select(['id', 'username', 'display_name', 'role', 'full_access', 'is_active'])
    .where('id', '=', session.admin_id)
    .executeTakeFirst();
  if (!admin || !admin.is_active) return null;
  return {
    id: admin.id,
    username: admin.username,
    displayName: admin.display_name,
    role: (admin.role as 'owner' | 'admin') ?? 'admin',
    fullAccess: admin.full_access !== false,
    sessionId: parsed.sessionId,
  };
}

export async function revokeSession(db: Kysely<DB>, sessionId: string): Promise<void> {
  await db.updateTable('admin_sessions')
    .set({ revoked_at: new Date().toISOString() })
    .where('token_hash', '=', sha256(sessionId))
    .execute();
}

/** Record an admin action in the audit log (each admin individually). */
export async function audit(
  db: Kysely<DB>,
  admin: Pick<AdminContext, 'id' | 'username'> | null,
  action: string,
  entity?: { type?: string; id?: string; detail?: Record<string, unknown> },
): Promise<void> {
  await db.insertInto('admin_audit_log').values({
    admin_id: admin?.id ?? null,
    admin_username: admin?.username ?? null,
    action,
    entity_type: entity?.type ?? null,
    entity_id: entity?.id ?? null,
    detail: JSON.stringify(entity?.detail ?? {}),
  }).execute().then(() => {}, () => {});
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}

/* ------------------------------ rate limiting ------------------------------ */

const MAX_FAILURES = 5;
const WINDOW_MINUTES = 10;

/** True when this ip/username pair has exceeded the failed-login budget. */
export async function isLoginRateLimited(db: Kysely<DB>, ip: string | null, username: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const rows = await db
    .selectFrom('login_attempts')
    .select(db.fn.countAll<number>().as('n'))
    .where('ok', '=', false)
    .where('created_at', '>', since)
    .where((eb) => eb.or([
      ...(ip ? [eb('ip', '=', ip)] : []),
      eb('username', '=', username.toLowerCase()),
    ]))
    .executeTakeFirst();
  return Number(rows?.n ?? 0) >= MAX_FAILURES;
}

export async function recordLoginAttempt(db: Kysely<DB>, ip: string | null, username: string, ok: boolean): Promise<void> {
  await db.insertInto('login_attempts').values({ ip, username: username.toLowerCase(), ok }).execute().then(() => {}, () => {});
}
