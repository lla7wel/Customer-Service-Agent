import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createSessionToken, isAuthConfigured, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sign in with the env-configured admin credentials → session cookie. */
export async function POST(req: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: 'auth_not_configured', missing: ['ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET'] },
      { status: 503 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !password) return NextResponse.json({ error: 'missing_credentials' }, { status: 400 });

  const adminEmail = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const hash = process.env.ADMIN_PASSWORD_HASH ?? '';
  const emailOk = email === adminEmail;
  // Always run the compare (constant-ish work) so a wrong email isn't
  // distinguishable from a wrong password by timing.
  const passwordOk = await bcrypt.compare(password, hash).catch(() => false);
  if (!emailOk || !passwordOk) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const token = await createSessionToken(adminEmail);
  if (!token) return NextResponse.json({ error: 'auth_not_configured' }, { status: 503 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
