import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest } from '@/lib/api';
import { audit } from '@/lib/auth';
import { isStorageConfigured, putObject } from '@integrations/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX = 5 * 1024 * 1024;
const TYPES = new Map([['image/png','png'],['image/webp','webp']]);
function isImage(bytes: Buffer, type: string) {
  if (type === 'image/png') return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminApi(req); if (!auth.ok) return auth.res;
  const kit = await auth.ctx.db.selectFrom('brand_kit').selectAll().where('id','=',1).executeTakeFirst();
  return NextResponse.json({ kit });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi(req); if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  if (!admin.fullAccess) return NextResponse.json({ error:'forbidden' }, { status:403 });
  if (!isStorageConfigured()) return NextResponse.json({ error:'storage_not_configured' }, { status:503 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('logo');
  if (!(file instanceof File)) return badRequest('missing_logo');
  if (file.size > MAX) return badRequest('file_too_large','Logo is limited to 5 MB.');
  const ext = TYPES.get(file.type); if (!ext) return badRequest('unsupported_type','Use a transparent PNG or WebP logo.');
  const bytes = Buffer.from(await file.arrayBuffer()); if (!isImage(bytes,file.type)) return badRequest('not_an_image');
  const objectPath = `brand-kit/logo-${Date.now()}.${ext}`;
  const stored = await putObject(objectPath, bytes);
  if (!stored.ok) return NextResponse.json({ error:'storage_failed',detail:stored.reason },{status:500});
  const kit = await db.updateTable('brand_kit').set({
    logo_storage_path: stored.data.path, logo_public_url: stored.data.publicUrl,
    updated_by: admin.id === '00000000-0000-0000-0000-000000000000' ? null : admin.id,
  }).where('id','=',1).returningAll().executeTakeFirst();
  await audit(db,admin,'brand_kit.logo_update',{type:'brand_kit',id:'1',detail:{storage_path:stored.data.path}});
  return NextResponse.json({ kit });
}
