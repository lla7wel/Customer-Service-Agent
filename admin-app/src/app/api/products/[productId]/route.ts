import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@integrations/supabase/admin-client';
import { supabaseStatus } from '@integrations/status';
import { lockEditedFields } from '@integrations/product-locks';

export const runtime = 'nodejs';

const EDITABLE = [
  'libyan_display_name', 'arabic_name', 'english_name', 'category', 'subcategory',
  'base_price', 'status', 'availability', 'search_keywords', 'arabic_keywords',
];

/** Edit a product. Admin can fully edit the product database. */
export async function PATCH(req: NextRequest, { params }: { params: { productId: string } }) {
  const db = adminClient();
  if (!db) {
    return NextResponse.json(
      { error: 'integration_not_configured', missing: supabaseStatus().missing.concat('SUPABASE_SERVICE_ROLE_KEY') },
      { status: 503 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) update[k] = body[k];
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'no_editable_fields' }, { status: 400 });
  }

  // Active/customer-facing products must have a real positive price.
  if ('base_price' in update) {
    const p = update.base_price;
    if (p !== null && p !== undefined && (typeof p !== 'number' || !Number.isFinite(p as number) || (p as number) <= 0)) {
      return NextResponse.json({ error: 'base_price_must_be_positive' }, { status: 400 });
    }
  }

  // Fetch current campaign state + existing lock map in one read.
  const { data: cur } = await db
    .from('products')
    .select('active_campaign_id, campaign_price, admin_locked_fields')
    .eq('id', params.productId)
    .maybeSingle();

  // When the admin edits base_price, keep active_price consistent: it mirrors
  // base_price unless a campaign price is currently overriding it.
  if ('base_price' in update) {
    const onCampaign = cur?.active_campaign_id != null && cur?.campaign_price != null;
    if (!onCampaign) update.active_price = update.base_price;
  }

  // Admin edits win forever: mark every edited field as locked so future
  // scraper sync / CSV re-import / matching / AI can never overwrite it.
  update.admin_locked_fields = lockEditedFields(cur?.admin_locked_fields, update);

  const { error } = await db.from('products').update(update).eq('id', params.productId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from('activity_logs').insert({
    actor_type: 'human',
    action: 'product_edit',
    entity_type: 'product',
    entity_id: params.productId,
    summary: `Edited ${Object.keys(update).join(', ')}`,
  });

  return NextResponse.json({ ok: true });
}
