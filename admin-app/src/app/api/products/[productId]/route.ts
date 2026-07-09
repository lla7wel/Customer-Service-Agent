import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@integrations/db/client';
import { databaseStatus } from '@integrations/status';
import { lockEditedFields } from '@integrations/product-locks';

export const runtime = 'nodejs';

const EDITABLE = [
  'libyan_display_name', 'arabic_name', 'english_name', 'category', 'subcategory',
  'base_price', 'status', 'availability', 'search_keywords', 'arabic_keywords',
];

/** Edit a product. Admin can fully edit the product database. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ productId: string }> }) {
  const params = await props.params;
  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'integration_not_configured', missing: databaseStatus().missing },
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
  const cur = await db
    .selectFrom('products')
    .select(['active_campaign_id', 'campaign_price', 'admin_locked_fields'])
    .where('id', '=', params.productId)
    .executeTakeFirst();

  // When the admin edits base_price, keep active_price consistent: it mirrors
  // base_price unless a campaign price is currently overriding it.
  if ('base_price' in update) {
    const onCampaign = cur?.active_campaign_id != null && cur?.campaign_price != null;
    if (!onCampaign) update.active_price = update.base_price;
  }

  // Admin edits win forever: mark every edited field as locked so future
  // scraper sync / CSV re-import / matching / AI can never overwrite it.
  update.admin_locked_fields = JSON.stringify(lockEditedFields(cur?.admin_locked_fields, update));

  try {
    await db.updateTable('products').set(update as any).where('id', '=', params.productId).execute();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'update_failed' }, { status: 500 });
  }

  await db.insertInto('activity_logs').values({
    actor_type: 'human',
    action: 'product_edit',
    entity_type: 'product',
    entity_id: params.productId,
    summary: `Edited ${Object.keys(update).filter((k) => k !== 'admin_locked_fields').join(', ')}`,
  }).execute();

  return NextResponse.json({ ok: true });
}
