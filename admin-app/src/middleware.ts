/**
 * Central auth gate for the admin control center — FAIL CLOSED (EH-012).
 *
 * Every dashboard page and every API route requires a signed-in admin session,
 * EXCEPT a small explicit allowlist:
 *   - /api/meta/webhook   (Meta's callback; verified by signature internally)
 *   - /api/health         (status probe, safe to expose)
 *   - /api/auth/          (the login/logout endpoints themselves)
 *   - /login              (the sign-in page itself)
 *
 * If SESSION_SECRET is missing the gate REFUSES to serve protected routes
 * (503) instead of allowing them. Local development may explicitly opt out
 * with AUTH_DISABLED_DEV=true — which is ignored in production builds.
 *
 * This layer verifies the signed session cookie (edge-safe). Revocation and
 * account state are enforced again in requireAdmin() inside API routes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken, isAuthConfigured } from '@/lib/auth-edge';
import { canAccessPath, landingPath } from '@/lib/rbac';

const PUBLIC_API_PREFIXES = ['/api/meta/webhook', '/api/health', '/api/auth/'];

/** Propagate the real request path so the (dashboard) layout can run the
 *  authoritative (DB-role) section guard — layouts do not receive the pathname. */
function pass(req: NextRequest): NextResponse {
  const headers = new Headers(req.headers);
  headers.set('x-eh-pathname', req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (!isAuthConfigured()) {
    const devBypass = process.env.NODE_ENV !== 'production' && process.env.AUTH_DISABLED_DEV === 'true';
    if (devBypass) return pass(req);
    // Fail closed: an unconfigured deployment must never expose the admin app.
    return pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'auth_not_configured', detail: 'SESSION_SECRET is missing — refusing to serve (fail-closed).' }, { status: 503 })
      : new NextResponse('Configuration error: SESSION_SECRET is not set. The admin app refuses to start without authentication.', { status: 503 });
  }

  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (pathname === '/login') return NextResponse.next();
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  // Signed in → never show the login page; land on the role's home.
  if (pathname === '/login') {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = landingPath(session.role);
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  // Edge section gate for pages (fast path; the DB-role guard in the dashboard
  // layout backs this up). API section authorization is enforced authoritatively
  // in requireAdminApi with the live DB role.
  if (!pathname.startsWith('/api/') && !canAccessPath(session.role, pathname)) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = landingPath(session.role);
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return pass(req);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
