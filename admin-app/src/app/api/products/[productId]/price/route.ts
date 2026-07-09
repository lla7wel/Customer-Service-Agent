import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@integrations/supabase/admin-client';
import { supabaseStatus } from '@integrations/status';
import { lockEditedFields } from '@integrations/product-locks';

export const runtime = 'nodejs';

/**
 * Price/Product Review action: admin completes a staged (draft) product by
 * entering a price AND confirming an Arabic/English customer-facing name, which
 * promotes it into the live catalog.
 *
 *   - sets base_price (+ active_price = campaign_price if a campaign is active)
 *   - sets english_name / arabic_name / libyan_display_name when provided
 *   - REQUIRES at least one Arabic/English name to exist before activating
 *     (Turkish source_name does NOT count — customer-facing language must be AR/EN)
 *   - sets status = 'active' (customer-visible)
 *   - logs the change to activity_logs
 *
 * The admin app is the source of truth — a later scraper sync never overwrites these.
 */
export async function POST(req: NextRequest, { params }: { params: { productId: string } }) {
  const db = adminClient();
  if (!db) {
    return NextResponse.json(
      { error: 'integration_not_configured', missing: supabaseStatus().missing.concat('SUPABASE_SERVICE_ROLE_KEY') },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const price = Number(body?.base_price);
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ error: 'invalid_price' }, { status: 400 });
  }

  const englishName = typeof body?.english_name === 'string' ? body.english_name.trim() : '';
  const arabicName = typeof body?.arabic_name === 'string' ? body.arabic_name.trim() : '';
  const libyanName = typeof body?.libyan_display_name === 'string' ? body.libyan_display_name.trim() : '';

  const { data: product, error: fErr } = await db
    .from('products')
    .select('id, active_campaign_id, campaign_price, english_name, arabic_name, libyan_display_name, admin_locked_fields')
    .eq('id', params.productId)
    .maybeSingle();
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });
  if (!product) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // A customer-facing Arabic/English name is required to activate.
  const willHaveName =
    englishName || arabicName || libyanName ||
    product.english_name || product.arabic_name || product.libyan_display_name;
  if (!willHaveName) {
    return NextResponse.json({ error: 'name_required' }, { status: 400 });
  }

  const onCampaign = product.active_campaign_id != null && product.campaign_price != null;
  const activePrice = onCampaign ? product.campaign_price : price;

  const update: Record<string, unknown> = { base_price: price, active_price: activePrice, status: 'active' };
  if (englishName) update.english_name = englishName;
  if (arabicName) update.arabic_name = arabicName;
  if (libyanName) update.libyan_display_name = libyanName;

  // Admin review is an admin decision: lock the price/name/status it sets.
  update.admin_locked_fields = lockEditedFields(product.admin_locked_fields, update);

  const { error } = await db.from('products').update(update).eq('id', params.productId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from('activity_logs').insert({
    actor_type: 'human',
    action: 'price_review_complete',
    entity_type: 'product',
    entity_id: params.productId,
    summary: `Activated product: price ${price} LYD${englishName ? `, en="${englishName}"` : ''}${arabicName ? `, ar="${arabicName}"` : ''}`,
  });

  return NextResponse.json({ ok: true, active_price: activePrice });
}
