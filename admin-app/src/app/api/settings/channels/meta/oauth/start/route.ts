import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { requireAdminApi, badRequest, forbidden } from '@/lib/api';
import { audit } from '@/lib/auth';
import { buildOAuthUrl, appBaseUrl, OAUTH_REDIRECT_PATH } from '@integrations/providers/meta-connect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Owner-only: begin the Facebook Login flow with a CSRF state bound to this session. */
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  if (admin.role !== 'owner') return forbidden();

  const url = buildOAuthUrl('placeholder');
  if (!url) return badRequest('app_id_missing', 'Set META_APP_ID (and META_APP_SECRET) to use Facebook login, or use manual setup.');

  const state = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.insertInto('provider_oauth_states').values({
    state, admin_id: admin.id === '00000000-0000-0000-0000-000000000000' ? null : admin.id,
    redirect_uri: appBaseUrl() + OAUTH_REDIRECT_PATH, expires_at: expiresAt,
  }).execute();

  await audit(db, admin, 'channels.meta.oauth_start', { type: 'provider_connection' });
  return NextResponse.json({ url: buildOAuthUrl(state) });
}
