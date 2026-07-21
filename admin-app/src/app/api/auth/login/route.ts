import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  createSession, isAuthConfigured, SESSION_COOKIE, sessionCookieOptions,
  isLoginRateLimited, recordLoginAttempt, audit,
} from '@/lib/auth';
import { getDb } from '@integrations/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim().slice(0, 60) : null;
}

/**
 * A throwaway bcrypt hash of random bytes, computed once per process. Comparing
 * against it keeps "unknown username" and "wrong password" indistinguishable by
 * timing without embedding any credential-shaped literal in the repository.
 */
let cachedDecoy: string | null = null;
function decoyHash(): string {
  if (!cachedDecoy) cachedDecoy = bcrypt.hashSync(randomBytes(24).toString('hex'), 12);
  return cachedDecoy;
}

/** Sign in with an admin-account username + password → session cookie. */
export async function POST(req: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ error: 'auth_not_configured', missing: ['SESSION_SECRET'] }, { status: 503 });
  }
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const username = typeof body?.username === 'string' ? body.username.trim() : (typeof body?.email === 'string' ? body.email.trim() : '');
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!username || !password) return NextResponse.json({ error: 'missing_credentials' }, { status: 400 });

  const ip = clientIp(req);
  if (await isLoginRateLimited(db, ip, username)) {
    return NextResponse.json({ error: 'rate_limited', detail: 'Too many failed attempts. Try again in a few minutes.' }, { status: 429 });
  }

  const admin = await db
    .selectFrom('admin_accounts')
    .select(['id', 'username', 'password_hash', 'is_active'])
    .where((eb) => eb(eb.fn('lower', ['username']), '=', username.toLowerCase()))
    .executeTakeFirst();

  // Always run a compare so a wrong username is indistinguishable by timing.
  // The decoy hash is generated at runtime from random bytes — no credential
  // literal ever lives in the source.
  const passwordOk = await bcrypt.compare(password, admin?.password_hash ?? decoyHash()).catch(() => false);
  const ok = !!admin && admin.is_active && passwordOk;

  await recordLoginAttempt(db, ip, username, ok);
  if (!ok) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const token = await createSession(db, { id: admin!.id, username: admin!.username }, {
    ip, userAgent: req.headers.get('user-agent'),
  });
  if (!token) return NextResponse.json({ error: 'auth_not_configured' }, { status: 503 });

  await db.updateTable('admin_accounts').set({ last_login_at: new Date().toISOString() }).where('id', '=', admin!.id).execute();
  await audit(db, { id: admin!.id, username: admin!.username }, 'auth.login', { detail: { ip: ip ?? undefined } });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
