import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@integrations/db/client';
import { databaseStatus } from '@integrations/status';
import { lockEditedFields } from '@integrations/product-locks';

export const runtime = 'nodejs';

/** Fields an admin may set when manually creating a product. */
const EDITABLE = [
  'product_code', 'barcode', 'libyan_display_name', 'arabic_name', 'english_name',
  'category', 'subcategory', 'base_price', 'website_url', 'search_keywords', 'arabic_keywords',
];

/**
 * Manually create a catalog product (admin-entered, not from the scraper/CSV).
 * The admin catalog is the price source of truth, so a manual product with a
 * price goes straight to `active` (customer-visible); without one it stays
 * `draft` for the price-review queue. Every field the admin sets is locked so a
 * later import can never overwrite it.
 */
export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'integration_not_configured', missing: databaseStatus().missing },
      { status: 503 },
    );
  }
  const body = await req.json().catch(() => ({}));

  const code = typeof body.product_code === 'string' ? body.product_code.trim() : '';
  if (!code) return NextResponse.json({ error: 'product_code_required' }, { status: 400 });
  const hasName = ['libyan_display_name', 'arabic_name', 'english_name']
    .some((k) => typeof body[k] === 'string' && body[k].trim());
  if (!hasName) return NextResponse.json({ error: 'name_required' }, { status: 400 });

  const insert: Record<string, unknown> = { product_code: code, source: 'manual' };
  for (const k of EDITABLE) if (k in body && k !== 'product_code') insert[k] = body[k];

  // Price truth: a manual product with a price is sellable immediately; without
  // one it waits in price review. active_price mirrors base_price (no campaign yet).
  const rawPrice = body.base_price;
  if (rawPrice !== undefined && rawPrice !== null) {
    if (typeof rawPrice !== 'number' || !Number.isFinite(rawPrice) || rawPrice <= 0) {
      return NextResponse.json({ error: 'base_price_must_be_positive' }, { status: 400 });
    }
  }
  const basePrice = typeof rawPrice === 'number' ? rawPrice : null;
  insert.base_price = basePrice;
  insert.active_price = basePrice;
  insert.status = basePrice != null ? 'active' : 'draft';

  // Lock everything the admin entered against future sync/import overwrites.
  insert.admin_locked_fields = JSON.stringify(lockEditedFields({}, insert));

  let data: { id: string; product_code: string };
  try {
    data = await db.insertInto('products').values(insert as any).returning(['id', 'product_code']).executeTakeFirstOrThrow();
  } catch (e: any) {
    const msg = e?.message ?? 'insert_failed';
    const conflict = /duplicate key|unique/i.test(msg);
    return NextResponse.json({ error: conflict ? 'product_code_exists' : msg }, { status: conflict ? 409 : 500 });
  }

  await db.insertInto('activity_logs').values({
    actor_type: 'human',
    action: 'product_created',
    entity_type: 'product',
    entity_id: data.id,
    summary: `Created product ${data.product_code}`,
  }).execute();

  return NextResponse.json({ ok: true, id: data.id, product_code: data.product_code });
}
