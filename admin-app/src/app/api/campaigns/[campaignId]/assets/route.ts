import { NextRequest, NextResponse } from 'next/server';
import { adminClient, storageBucket } from '@integrations/supabase/admin-client';
import { supabaseStatus } from '@integrations/status';

export const runtime = 'nodejs';

/**
 * Upload campaign images (multipart/form-data, field "files") to Supabase Storage
 * and link them as campaign_assets. Saves/links to the DB so the campaign owns
 * its assets even before posting.
 */
export async function POST(req: NextRequest, { params }: { params: { campaignId: string } }) {
  const db = adminClient();
  if (!db) {
    return NextResponse.json({ error: 'integration_not_configured', missing: supabaseStatus().missing.concat('SUPABASE_SERVICE_ROLE_KEY') }, { status: 503 });
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

  const bucket = storageBucket();
  const { count } = await db.from('campaign_assets').select('id', { count: 'exact', head: true }).eq('campaign_id', id);
  let pos = count ?? 0;
  const created: { id: string; public_url: string }[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `campaigns/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { error: upErr } = await db.storage.from(bucket).upload(path, bytes, {
        contentType: file.type || 'image/jpeg',
        upsert: true,
      });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = db.storage.from(bucket).getPublicUrl(path);
      const { data: asset, error: insErr } = await db
        .from('campaign_assets')
        .insert({ campaign_id: id, kind: 'uploaded_image', storage_path: path, public_url: pub.publicUrl, position: pos++ })
        .select('id, public_url')
        .single();
      if (insErr) throw new Error(insErr.message);
      created.push({ id: asset.id, public_url: asset.public_url });
    } catch (e: any) {
      errors.push(`${file.name}: ${e.message}`);
    }
  }

  await db.from('activity_logs').insert({ actor_type: 'human', action: 'campaign_generated', entity_type: 'campaign', entity_id: id, summary: `Uploaded ${created.length} image(s)` });
  return NextResponse.json({ ok: true, created, errors });
}
