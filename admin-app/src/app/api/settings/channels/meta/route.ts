import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest, forbidden } from '@/lib/api';
import { audit } from '@/lib/auth';
import { getMetaConnectionMeta, saveMetaConnection, importEnvConnectionOnce } from '@integrations/providers/connection';
import { repairSubscriptions, validatePageToken, appBaseUrl, OAUTH_REDIRECT_PATH, WEBHOOK_PATH } from '@integrations/providers/meta-connect';
import { isEncryptionConfigured } from '@integrations/providers/secret-crypto';
import { runAllReadinessChecks } from '@integrations/providers/readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Connection status + readiness + the two (different) Meta URLs. Owner-only. */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  if (admin.role !== 'owner') return forbidden();

  // Import valid env credentials into encrypted storage once (never exposed).
  await importEnvConnectionOnce(db).catch(() => {});

  const [connection, readiness] = await Promise.all([
    getMetaConnectionMeta(db),
    db.selectFrom('provider_readiness').select(['check_key', 'ok', 'summary', 'detail', 'checked_at']).orderBy('check_key', 'asc').execute(),
  ]);
  return NextResponse.json({
    connection,
    readiness,
    encryption_configured: isEncryptionConfigured(),
    urls: {
      oauth_redirect: appBaseUrl() + OAUTH_REDIRECT_PATH,
      webhook_callback: appBaseUrl() + WEBHOOK_PATH,
    },
  });
}

/** Owner actions: manual setup, validate, repair subscriptions, run check, disconnect. */
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  if (admin.role !== 'owner') return forbidden();

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? '');

  if (action === 'manual') {
    if (!isEncryptionConfigured()) return badRequest('encryption_not_configured', 'Set INTEGRATION_ENCRYPTION_KEY on the server before storing credentials.');
    const pageAccessToken = typeof body?.page_access_token === 'string' ? body.page_access_token.trim() : '';
    const pageId = typeof body?.page_id === 'string' ? body.page_id.trim() : '';
    if (!pageAccessToken || !pageId) return badRequest('missing_fields', 'Page ID and Page access token are required.');
    await saveMetaConnection(db, {
      pageAccessToken,
      pageId,
      appSecret: typeof body?.app_secret === 'string' && body.app_secret.trim() ? body.app_secret.trim() : undefined,
      verifyToken: typeof body?.verify_token === 'string' && body.verify_token.trim() ? body.verify_token.trim() : undefined,
      igUserId: typeof body?.ig_user_id === 'string' && body.ig_user_id.trim() ? body.ig_user_id.trim() : null,
      source: 'manual',
      status: 'connected',
    });
    const validation = await validatePageToken(db);
    await audit(db, admin, 'channels.meta.manual_setup', { type: 'provider_connection', detail: { page_id: pageId, valid: validation.ok } });
    return NextResponse.json({ ok: true, validation });
  }

  if (action === 'validate') {
    const validation = await validatePageToken(db);
    return NextResponse.json({ ok: validation.ok, validation });
  }

  if (action === 'repair') {
    const result = await repairSubscriptions(db);
    await audit(db, admin, 'channels.meta.repair', { type: 'provider_connection', detail: { page_ok: result.page.ok, ig_ok: result.instagram?.ok ?? null } });
    return NextResponse.json({ ok: result.page.ok, result });
  }

  if (action === 'check') {
    const results = await runAllReadinessChecks(db);
    return NextResponse.json({ ok: true, results });
  }

  if (action === 'disconnect') {
    await db.updateTable('provider_connections').set({
      page_access_token_enc: null, app_secret_enc: null, verify_token_enc: null, user_access_token_enc: null,
      page_token_tail: null, status: 'disconnected', page_subscribed_fields: [], ig_subscribed_fields: [],
    }).where('id', '=', 1).execute();
    await audit(db, admin, 'channels.meta.disconnect', { type: 'provider_connection' });
    return NextResponse.json({ ok: true });
  }

  return badRequest('unknown_action');
}
