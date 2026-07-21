import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest, forbidden, notFound } from '@/lib/api';
import { audit } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Version history for one behavior key (?key=customer_service). */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  if (auth.ctx.admin.role !== 'owner') return forbidden();
  const { db } = auth.ctx;
  const key = req.nextUrl.searchParams.get('key');
  if (!key) return badRequest('missing_key');
  const versions = await db
    .selectFrom('ai_behavior_versions')
    .leftJoin('admin_accounts', 'admin_accounts.id', 'ai_behavior_versions.saved_by')
    .select([
      'ai_behavior_versions.id', 'behavior_key', 'ai_behavior_versions.title',
      'ai_behavior_versions.prompt', 'ai_behavior_versions.rules', 'ai_behavior_versions.memory',
      'ai_behavior_versions.enabled', 'note', 'ai_behavior_versions.created_at',
      'admin_accounts.username as saved_by_username',
    ])
    .where('behavior_key', '=', key)
    .orderBy('ai_behavior_versions.created_at', 'desc')
    .limit(50)
    .execute();
  return NextResponse.json({ versions });
}

/** One-click restore of an earlier version (takes effect immediately). */
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  if (auth.ctx.admin.role !== 'owner') return forbidden();
  const { db, admin } = auth.ctx;
  const body = await req.json().catch(() => ({}));
  const versionId = Number(body?.versionId);
  if (!Number.isFinite(versionId)) return badRequest('missing_version_id');

  const version = await db
    .selectFrom('ai_behavior_versions')
    .selectAll()
    .where('id', '=', versionId)
    .executeTakeFirst();
  if (!version) return notFound('version_not_found');

  await db.updateTable('ai_behaviors')
    .set({
      title: version.title ?? version.behavior_key,
      prompt: version.prompt,
      rules: version.rules,
      memory: version.memory,
      enabled: version.enabled,
    })
    .where('behavior_key', '=', version.behavior_key)
    .execute();

  await db.insertInto('ai_behavior_versions').values({
    behavior_key: version.behavior_key,
    title: version.title,
    prompt: version.prompt,
    rules: version.rules,
    memory: version.memory,
    enabled: version.enabled,
    saved_by: admin.id === '00000000-0000-0000-0000-000000000000' ? null : admin.id,
    note: `restored version #${versionId}`,
  }).execute();

  await audit(db, admin, 'ai.behavior_restore', { type: 'ai_behavior', id: version.behavior_key, detail: { version_id: versionId } });
  return NextResponse.json({ ok: true, behavior_key: version.behavior_key });
}
