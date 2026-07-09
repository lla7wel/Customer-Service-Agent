/**
 * Save an admin image-match correction. POST sets corrected_product_id on an
 * image_match_corrections row so the pipeline learns from the correction.
 * The next near-identical customer image skips Gemini and uses this correction.
 * Called by: components/image-review/ImageReviewClient.tsx.
 * Calls: integrations/util/image-hash (dhashFromUrl), integrations/supabase/admin-client.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@integrations/supabase/admin-client';
import { supabaseStatus } from '@integrations/status';
import { dhashFromUrl } from '@integrations/util/image-hash';
import { customerProductName } from '@integrations/util/product-display';
import { saveImageCorrection } from '@integrations/tools';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { correctionId: string } }) {
  const db = adminClient();
  if (!db) {
    return NextResponse.json(
      { error: 'integration_not_configured', missing: supabaseStatus().missing.concat('SUPABASE_SERVICE_ROLE_KEY') },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const productId = typeof body?.productId === 'string' ? body.productId : '';
  if (!productId) return NextResponse.json({ error: 'missing_product' }, { status: 400 });

  const [{ data: correction }, { data: product }] = await Promise.all([
    db
      .from('image_match_corrections')
      .select('id, conversation_id, message_id, customer_image_url, customer_image_hash')
      .eq('id', params.correctionId)
      .maybeSingle(),
    db
      .from('products')
      .select('id, product_code, libyan_display_name, arabic_name, english_name, source_name, arabic_keywords')
      .eq('id', productId)
      .maybeSingle(),
  ]);

  if (!correction) return NextResponse.json({ error: 'correction_not_found' }, { status: 404 });
  if (!product) return NextResponse.json({ error: 'product_not_found' }, { status: 404 });

  let hash = (correction as any).customer_image_hash ?? null;
  const imageUrl = (correction as any).customer_image_url ?? null;
  if (!hash && imageUrl) hash = await dhashFromUrl(imageUrl);

  // Save the correction AND feed the fingerprint back into future matching.
  const saved = await saveImageCorrection(db, {
    correctionId: params.correctionId,
    correctedProductId: productId,
    customerImageUrl: imageUrl,
    customerImageHash: hash,
    notes: typeof body?.notes === 'string' ? body.notes : null,
  });
  if (!saved.ok) return NextResponse.json({ error: saved.reason }, { status: 500 });

  await db.from('activity_logs').insert({
    actor_type: 'human',
    action: 'image_match_corrected',
    entity_type: 'conversation',
    entity_id: (correction as any).conversation_id ?? null,
    summary: `Image matched to ${customerProductName(product)}`,
    meta: { correction_id: params.correctionId, product_id: productId, learned: !!hash },
  });

  return NextResponse.json({ ok: true, learned: !!hash, product_name: customerProductName(product) });
}
