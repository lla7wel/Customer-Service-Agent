/**
 * Edge-safe auth primitives (jose/Web Crypto only — no Node, no database).
 * The middleware imports ONLY from this file so pg never enters the edge
 * bundle. Full session validation (revocation, account state) happens in
 * requireAdmin() from ./auth on the nodejs runtime.
 */
import { SignJWT, jwtVerify } from 'jose';
import { normalizeRole, type Role } from './rbac';

export const SESSION_COOKIE = 'eh_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export function secretKey(): Uint8Array | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
}

export function isAuthConfigured(): boolean {
  return !!secretKey();
}

export async function signSessionJwt(adminId: string, sessionId: string, username: string, role: Role): Promise<string | null> {
  const key = secretKey();
  if (!key) return null;
  return new SignJWT({ sub: adminId, sid: sessionId, usr: username, rol: role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key);
}

/**
 * Edge-safe token check (signature + expiry only). The role travels in the token
 * so the middleware can gate sections at the edge; because a role change revokes
 * the admin's sessions, the token role can never outlive the change. The DB role
 * remains authoritative for API/data access (requireAdmin re-reads it).
 */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<{ adminId: string; sessionId: string; role: Role } | null> {
  if (!token) return null;
  const key = secretKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof (payload as any).sid !== 'string') return null;
    return { adminId: payload.sub, sessionId: (payload as any).sid, role: normalizeRole((payload as any).rol) };
  } catch {
    return null;
  }
}
