import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest, notFound } from '@/lib/api';
import { putObject, isStorageConfigured } from '@integrations/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

/** Magic-byte check so a spoofed content-type cannot smuggle non-images. */
function sniffImage(buf: Buffer): boolean {
  return (
    (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ||
    (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ||
    (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46)
  );
}

/** Upload an original image asset for a content item (validated). */
export async function POST(req: NextRequest, props: { params: Promise<{ contentId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db } = auth.ctx;
  const { contentId } = await props.params;
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: 'storage_not_configured' }, { status: 503 });
  }

  const item = await db.selectFrom('content_items').select(['id', 'status']).where('id', '=', contentId).executeTakeFirst();
  if (!item) return notFound();
  if (!['draft', 'ready', 'failed'].includes(item.status)) return badRequest('not_editable');

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return badRequest('missing_file');
  if (file.size > MAX_UPLOAD_BYTES) return badRequest('file_too_large', 'Images are limited to 10 MB.');
  const ext = ALLOWED.get(file.type);
  if (!ext) return badRequest('unsupported_type', 'Only JPEG, PNG and WebP images are accepted.');

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!sniffImage(bytes)) return badRequest('not_an_image');

  const position = await db.selectFrom('content_assets')
    .select(db.fn.countAll<number>().as('n'))
    .where('content_item_id', '=', contentId)
    .executeTakeFirst();
  const objectPath = `content/${contentId}/upload-${Date.now()}.${ext}`;
  const stored = await putObject(objectPath, bytes);
  if (!stored.ok) return NextResponse.json({ error: 'storage_failed', detail: stored.reason }, { status: 500 });

  const asset = await db.insertInto('content_assets').values({
    content_item_id: contentId,
    kind: 'uploaded',
    storage_path: stored.data.path,
    public_url: stored.data.publicUrl,
    position: Number(position?.n ?? 0),
  }).returningAll().executeTakeFirst();
  return NextResponse.json({ asset }, { status: 201 });
}
