import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest, notFound } from '@/lib/api';
import { audit } from '@/lib/auth';
import { lockEditedFields } from '@integrations/product-locks';
import { changePriceManual } from '@integrations/catalog/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EDITABLE = [
  'libyan_display_name', 'arabic_name', 'english_name', 'category', 'subcategory',
  'status', 'availability', 'search_keywords', 'arabic_keywords',
];

/**
 * Edit a product. Every edited field becomes admin-LOCKED so no later CSV
 * import can overwrite it.
 *
 * Price changes route through the pricing engine (versioned history, promotion
 * precedence) rather than being written here directly, and the catalog
 * invariant is enforced: a product can only be ACTIVE with a positive price
 * and a customer-facing Arabic/English name (EH-027).
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ productId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  const params = await props.params;

  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) update[k] = body[k];

  const priceRequested = 'base_price' in body && body.base_price !== null && body.base_price !== undefined;
  if (priceRequested) {
    const p = Number(body.base_price);
    if (!Number.isFinite(p) || p <= 0) return badRequest('base_price_must_be_positive');
  }
  if (Object.keys(update).length === 0 && !priceRequested) {
    return badRequest('no_editable_fields');
  }

  const cur = await db
    .selectFrom('products')
    .select(['id', 'base_price', 'active_price', 'status',
             'libyan_display_name', 'arabic_name', 'english_name', 'admin_locked_fields'])
    .where('id', '=', params.productId)
    .executeTakeFirst();
  if (!cur) return notFound('product_not_found');

  // Catalog invariant: ACTIVE requires a positive price AND a customer-facing
  // Arabic/English name (a Turkish source name does not count).
  const nextStatus = (update.status as string | undefined) ?? cur.status;
  if (nextStatus === 'active') {
    const willHavePrice = priceRequested || cur.base_price != null;
    const willHaveName = [
      update.libyan_display_name ?? cur.libyan_display_name,
      update.arabic_name ?? cur.arabic_name,
      update.english_name ?? cur.english_name,
    ].some((n) => typeof n === 'string' && n.trim().length > 0);
    if (!willHavePrice) return badRequest('price_required', 'An active product must have a positive price.');
    if (!willHaveName) return badRequest('name_required', 'An active product needs an Arabic or English customer-facing name.');
  }

  if (priceRequested) {
    await changePriceManual(db, {
      productId: params.productId,
      newPrice: Number(body.base_price),
      adminId: admin.id === '00000000-0000-0000-0000-000000000000' ? null : admin.id,
      note: 'catalog edit',
    });
  }

  if (Object.keys(update).length) {
    // Admin edits win forever: every edited field is locked against imports.
    // The lock map is merged on top of the CURRENT row (changePriceManual may
    // have just added base_price) so no lock is clobbered by write ordering.
    const fresh = await db
      .selectFrom('products').select('admin_locked_fields')
      .where('id', '=', params.productId).executeTakeFirst();
    const withLocks = {
      ...update,
      admin_locked_fields: JSON.stringify(lockEditedFields(fresh?.admin_locked_fields ?? cur.admin_locked_fields, update)),
    };
    try {
      await db.updateTable('products').set(withLocks as any).where('id', '=', params.productId).execute();
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'update_failed' }, { status: 500 });
    }
  }

  await audit(db, admin, 'product.update', {
    type: 'product', id: params.productId,
    detail: { fields: Object.keys(update), price_changed: priceRequested },
  });
  await db.insertInto('activity_logs').values({
    actor_type: 'human',
    action: 'product_edit',
    entity_type: 'product',
    entity_id: params.productId,
    summary: `Edited ${[...Object.keys(update), ...(priceRequested ? ['base_price'] : [])].join(', ')}`,
  }).execute();

  return NextResponse.json({ ok: true });
}
