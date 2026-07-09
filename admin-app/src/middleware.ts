/**
 * Central auth gate for the admin control center.
 *
 * Every dashboard page and every API route requires a signed-in admin session,
 * EXCEPT a small explicit allowlist:
 *   - /api/meta/webhook            (Meta's callback; verified by signature/verify-token internally)
 *   - /api/health                  (status probe, safe to expose)
 *   - /api/cron/campaign-scheduler (protected by CRON_SECRET internally)
 *   - /api/auth/                   (the login/logout endpoints themselves)
 *   - /login                       (the sign-in page itself)
 *
 * The app talks to Postgres directly (no row-level auth), so without this gate
 * any unauthenticated HTTP caller could read and mutate the whole database.
 * This middleware is that gate.
 *
 * If SESSION_SECRET is not configured (local/unconfigured dev), the gate is a
 * no-op so the app still runs; in production it is always set.
 */
import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

/** API routes that must stay reachable without an admin session. */
const PUBLIC_API_PREFIXES = ['/api/meta/webhook', '/api/health', '/api/cron/', '/api/auth/'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public API endpoints handle their own auth (or need none). Let them through.
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Auth not configured → cannot gate; allow through (degraded local dev only).
  if (!process.env.SESSION_SECRET) return NextResponse.next();

  const email = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);

  if (!email) {
    // Unauthenticated API calls → 401 JSON (never an HTML redirect).
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    // The login page itself stays reachable.
    if (pathname === '/login') return NextResponse.next();
    // Everything else → redirect to sign in.
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  // Already signed in but sitting on /login → send to the dashboard.
  if (pathname === '/login') {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static asset files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
