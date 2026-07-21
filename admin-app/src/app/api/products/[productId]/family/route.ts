import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi, badRequest, notFound } from '@/lib/api';
import { audit } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Family + variants + related products for one product. */
export async function GET(req: NextRequest, props: { params: Promise<{ productId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db } = auth.ctx;
  const params = await props.params;

  const product = await db
    .selectFrom('products')
    .select(['id', 'family_id', 'family_locked', 'variant_label'])
    .where('id', '=', params.productId)
    .executeTakeFirst();
  if (!product) return notFound('product_not_found');

  const [family, siblings, relations] = await Promise.all([
    product.family_id
      ? db.selectFrom('product_families').selectAll().where('id', '=', product.family_id).executeTakeFirst()
      : Promise.resolve(null),
    product.family_id
      ? db.selectFrom('products')
          .select(['id', 'product_code', 'english_name', 'arabic_name', 'libyan_display_name', 'variant_label', 'active_price', 'status'])
          .where('family_id', '=', product.family_id)
          .where('id', '!=', params.productId)
          .limit(50).execute()
      : Promise.resolve([]),
    db.selectFrom('product_relations as pr')
      .innerJoin('products as p', 'p.id', 'pr.related_product_id')
      .select(['pr.id as relation_id', 'pr.relation_type', 'pr.source', 'pr.locked',
               'p.id', 'p.product_code', 'p.english_name', 'p.arabic_name', 'p.libyan_display_name', 'p.active_price', 'p.status'])
      .where('pr.product_id', '=', params.productId)
      .execute(),
  ]);
  return NextResponse.json({
    family: family ?? null,
    family_locked: product.family_locked,
    variant_label: product.variant_label,
    siblings,
    relations,
  });
}

/**
 * Admin family/relation corrections — permanent (family_locked / relation
 * locked=true survives every automatic regrouping).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ productId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;
  const params = await props.params;
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? '');

  switch (action) {
    case 'set_family': {
      // familyId null detaches; a new family can be created inline by name.
      let familyId = body?.familyId ? String(body.familyId) : null;
      const newFamilyName = typeof body?.newFamilyName === 'string' ? body.newFamilyName.trim() : '';
      if (!familyId && newFamilyName) {
        const created = await db.insertInto('product_families')
          .values({ name: newFamilyName, kind: 'admin' })
          .returning('id').executeTakeFirst();
        familyId = created?.id ?? null;
      }
      await db.updateTable('products')
        .set({
          family_id: familyId,
          family_locked: true,
          ...(typeof body?.variantLabel === 'string' ? { variant_label: body.variantLabel.trim() || null } : {}),
        })
        .where('id', '=', params.productId)
        .execute();
      await audit(db, admin, 'catalog.family_set', { type: 'product', id: params.productId, detail: { family_id: familyId } });
      return NextResponse.json({ ok: true, family_id: familyId });
    }
    case 'add_relation': {
      const relatedId = String(body?.relatedProductId ?? '');
      const relationType = String(body?.relationType ?? 'complementary');
      if (!relatedId || relatedId === params.productId) return badRequest('invalid_related_product');
      if (!['variant', 'set_member', 'complementary', 'similar'].includes(relationType)) return badRequest('invalid_relation_type');
      await db.insertInto('product_relations')
        .values({ product_id: params.productId, related_product_id: relatedId, relation_type: relationType, source: 'admin', locked: true })
        .onConflict((oc) => oc.columns(['product_id', 'related_product_id', 'relation_type']).doUpdateSet({ source: 'admin', locked: true }))
        .execute();
      await audit(db, admin, 'catalog.relation_add', { type: 'product', id: params.productId, detail: { related_id: relatedId, relation_type: relationType } });
      return NextResponse.json({ ok: true });
    }
    case 'remove_relation': {
      const relationId = String(body?.relationId ?? '');
      if (!relationId) return badRequest('missing_relation_id');
      await db.deleteFrom('product_relations').where('id', '=', relationId).where('product_id', '=', params.productId).execute();
      await audit(db, admin, 'catalog.relation_remove', { type: 'product', id: params.productId, detail: { relation_id: relationId } });
      return NextResponse.json({ ok: true });
    }
    default:
      return badRequest('unknown_action');
  }
}
