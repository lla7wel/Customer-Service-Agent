import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken, revokeSession, sessionCookieOptions } from '@/lib/auth';
import { getDb } from '@integrations/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sign out: revoke the DB session and clear the cookie. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const parsed = await verifySessionToken(token);
  const db = getDb();
  if (parsed && db) {
    await revokeSession(db, parsed.sessionId).catch(() => {});
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
