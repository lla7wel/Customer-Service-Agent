import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest, notFound } from '@/lib/api';
import { audit } from '@/lib/auth';
import { changePriceManual } from '@integrations/catalog/pricing';
import { lockEditedFields } from '@integrations/product-locks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Manual admin price change — the ONLY manual price write path.
 *
 * Routes through the pricing engine: versioned history, promotion precedence
 * (a later manual price permanently supersedes an open promotion), and a
 * base_price lock so CSV imports never overwrite an admin decision.
 * Optionally completes customer-facing names and activates the product —
 * activation REQUIRES a price and an Arabic/English name (EH-027).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ productId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  const params = await props.params;

  const body = await req.json().catch(() => ({}));
  const price = Number(body?.base_price ?? body?.price);
  if (!Number.isFinite(price) || price <= 0) return badRequest('invalid_price');

  const product = await db
    .selectFrom('products')
    .select(['id', 'english_name', 'arabic_name', 'libyan_display_name', 'status', 'admin_locked_fields'])
    .where('id', '=', params.productId)
    .executeTakeFirst();
  if (!product) return notFound('product_not_found');

  const englishName = typeof body?.english_name === 'string' ? body.english_name.trim() : '';
  const arabicName = typeof body?.arabic_name === 'string' ? body.arabic_name.trim() : '';
  const libyanName = typeof body?.libyan_display_name === 'string' ? body.libyan_display_name.trim() : '';

  const nameUpdate: Record<string, unknown> = {};
  if (englishName) nameUpdate.english_name = englishName;
  if (arabicName) nameUpdate.arabic_name = arabicName;
  if (libyanName) nameUpdate.libyan_display_name = libyanName;

  const willHaveName = !!(
    englishName || arabicName || libyanName ||
    product.english_name || product.arabic_name || product.libyan_display_name
  );
  const activate = body?.activate !== false && willHaveName;
  if (body?.activate === true && !willHaveName) {
    return badRequest('name_required', 'An Arabic or English customer-facing name is required before activation.');
  }

  await changePriceManual(db, {
    productId: params.productId,
    newPrice: price,
    adminId: admin.id === '00000000-0000-0000-0000-000000000000' ? null : admin.id,
    note: typeof body?.note === 'string' ? body.note.slice(0, 300) : undefined,
  });

  if (Object.keys(nameUpdate).length || (activate && product.status !== 'active')) {
    const update = { ...nameUpdate, ...(activate ? { status: 'active' } : {}) };
    await db.updateTable('products')
      .set({
        ...update,
        admin_locked_fields: JSON.stringify(lockEditedFields(product.admin_locked_fields, update)),
      } as any)
      .where('id', '=', params.productId)
      .execute();
  }

  await audit(db, admin, 'price.change', {
    type: 'product', id: params.productId,
    detail: { new_price: price, activated: activate && product.status !== 'active' },
  });
  return NextResponse.json({ ok: true });
}
