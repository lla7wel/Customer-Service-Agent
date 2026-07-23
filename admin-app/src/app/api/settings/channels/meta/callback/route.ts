import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, SESSION_COOKIE, audit } from '@/lib/auth';
import { getDb } from '@integrations/db/client';
import { exchangeCodeForToken, longLivedToken, discoverConnection } from '@integrations/providers/meta-connect';
import { saveMetaConnection } from '@integrations/providers/connection';
import { isEncryptionConfigured } from '@integrations/providers/secret-crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function back(reason: string): NextResponse {
  const base = (process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return NextResponse.redirect(`${base}/settings?tab=channels&oauth=${encodeURIComponent(reason)}`);
}

/**
 * Facebook OAuth callback (top-level browser redirect). Validates the CSRF
 * state, exchanges the code server-side, discovers the Page + linked Instagram
 * account, and stores the connection encrypted. Owner-only.
 */
export async function GET(req: NextRequest) {
  const db = getDb();
  if (!db) return back('db_error');
  const admin = await requireAdmin(req.cookies.get(SESSION_COOKIE)?.value);
  if (!admin || admin.role !== 'owner') return back('forbidden');
  if (!isEncryptionConfigured()) return back('encryption_not_configured');

  const params = req.nextUrl.searchParams;
  const code = params.get('code');
  const state = params.get('state');
  if (params.get('error')) return back('denied');
  if (!code || !state) return back('missing_code');

  // Single-use CSRF state, bound to the admin that started the flow.
  const row = await db.selectFrom('provider_oauth_states').selectAll().where('state', '=', state).executeTakeFirst();
  if (!row || row.consumed_at || new Date(row.expires_at as any) < new Date()) return back('bad_state');
  if (row.admin_id && row.admin_id !== admin.id) return back('bad_state');
  await db.updateTable('provider_oauth_states').set({ consumed_at: new Date().toISOString() }).where('state', '=', state).execute();

  try {
    const exchanged = await exchangeCodeForToken(code);
    const userToken = exchanged.access_token;
    const longLived = await longLivedToken(userToken);
    const finalUserToken = longLived?.access_token || userToken;
    const discovered = await discoverConnection(finalUserToken);
    const page = discovered.pages.find((p) => p.accessToken);
    if (!page) return back('no_page');
    if (discovered.pages.length > 1) {
      // Page selection for multiple valid Pages is not auto-resolved here; the
      // owner can use manual setup to choose. Save nothing to avoid a wrong pick.
      return back('multiple_pages');
    }

    await saveMetaConnection(db, {
      pageAccessToken: page.accessToken,
      userAccessToken: finalUserToken,
      pageId: page.id,
      pageName: page.name,
      igUserId: page.igUserId,
      igUsername: page.igUsername,
      appId: discovered.appId,
      grantedScopes: discovered.grantedScopes,
      tokenExpiresAt: longLived?.expires_in ? new Date(Date.now() + longLived.expires_in * 1000).toISOString() : null,
      source: 'oauth',
      status: 'connected',
    });
    await audit(db, admin, 'channels.meta.oauth_connected', { type: 'provider_connection', detail: { page_id: page.id, ig: page.igUserId } });
    return back('connected');
  } catch {
    return back('exchange_failed');
  }
}
