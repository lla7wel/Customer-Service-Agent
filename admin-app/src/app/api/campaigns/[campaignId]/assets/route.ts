import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@integrations/db/client';
import { putObject } from '@integrations/storage';
import { databaseStatus } from '@integrations/status';

export const runtime = 'nodejs';

/**
 * Upload campaign images (multipart/form-data, field "files") to media storage
 * and link them as campaign_assets. Saves/links to the DB so the campaign owns
 * its assets even before posting.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ campaignId: string }> }) {
  const params = await props.params;
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'integration_not_configured', missing: databaseStatus().missing }, { status: 503 });
  }
  const id = params.campaignId;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'expected_multipart_form_data' }, { status: 400 });
  }
  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: 'no_files' }, { status: 400 });

  const countRow = await db.selectFrom('campaign_assets').select((eb) => eb.fn.countAll().as('n')).where('campaign_id', '=', id).executeTakeFirst();
  let pos = Number(countRow?.n ?? 0);
  const created: { id: string; public_url: string }[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `campaigns/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const up = await putObject(path, bytes);
      if (!up.ok) throw new Error(up.reason);
      const asset = await db
        .insertInto('campaign_assets')
        .values({ campaign_id: id, kind: 'uploaded_image', storage_path: up.data.path, public_url: up.data.publicUrl, position: pos++ })
        .returning(['id', 'public_url'])
        .executeTakeFirstOrThrow();
      created.push({ id: asset.id, public_url: asset.public_url! });
    } catch (e: any) {
      errors.push(`${file.name}: ${e.message}`);
    }
  }

  await db.insertInto('activity_logs').values({ actor_type: 'human', action: 'campaign_generated', entity_type: 'campaign', entity_id: id, summary: `Uploaded ${created.length} image(s)` }).execute();
  return NextResponse.json({ ok: true, created, errors });
}
