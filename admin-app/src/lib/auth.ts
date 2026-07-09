/**
 * Single-admin session auth.
 *
 * Credentials live in env (ADMIN_EMAIL + ADMIN_PASSWORD_HASH, a bcrypt hash);
 * a signed jose HS256 JWT in an httpOnly cookie carries the session. jose
 * verifies via Web Crypto, so the middleware (edge runtime) can check the
 * session without Node APIs. bcrypt comparison happens only in the login
 * route (nodejs runtime).
 *
 * Generate a password hash:
 *   node -e "require('bcryptjs').hash(process.argv[1],12).then(console.log)" 'your-password'
 */
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'eh_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function secretKey(): Uint8Array | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) return null;
  return new TextEncoder().encode(secret);
}

export function isAuthConfigured(): boolean {
  return !!process.env.ADMIN_EMAIL && !!process.env.ADMIN_PASSWORD_HASH && !!secretKey();
}

/** Create a signed session token for the admin. */
export async function createSessionToken(email: string): Promise<string | null> {
  const key = secretKey();
  if (!key) return null;
  return new SignJWT({ sub: email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key);
}

/** Verify a session token → admin email, or null. Edge-safe. */
export async function verifySessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const key = secretKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
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
