/**
 * Central auth gate for the admin control center.
 *
 * Every dashboard page and every API route requires a signed-in Supabase user,
 * EXCEPT a small explicit allowlist:
 *   - /api/meta/webhook          (Meta's callback; verified by signature/verify-token internally)
 *   - /api/health                (status probe, safe to expose)
 *   - /api/cron/campaign-scheduler (protected by CLOUDFLARE_WEBHOOK_SECRET internally)
 *   - /login                     (the sign-in page itself)
 *
 * The app reads data through the service-role key (see lib/supabase/db.ts), which
 * bypasses RLS — so without this gate any unauthenticated HTTP caller could read
 * and mutate the whole database. This middleware is that gate.
 *
 * If Supabase auth env is not configured (local/unconfigured dev), the gate is a
 * no-op so the app still runs; in production both public env vars are always set.
 */
import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

/** API routes that must stay reachable without an admin session. */
const PUBLIC_API_PREFIXES = ['/api/meta/webhook', '/api/health', '/api/cron/'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public API endpoints handle their own auth (or need none). Let them through.
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Auth not configured → cannot gate; allow through (degraded local dev only).
  if (!url || !anon) return NextResponse.next();

  let res = NextResponse.next({ request: { headers: req.headers } });

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: { headers: req.headers } });
        cookiesToSet.forEach(({ name, value, options }) =>
          res.cookies.set(name, value, options as any),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Unauthenticated API calls → 401 JSON (never an HTML redirect).
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    // The login page itself stays reachable.
    if (pathname === '/login') return res;
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

  return res;
}

export const config = {
  // Run on everything except Next internals and static asset files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
