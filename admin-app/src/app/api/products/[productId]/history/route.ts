import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Verified price history + open promotion for one product. */
export async function GET(req: NextRequest, props: { params: Promise<{ productId: string }> }) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db } = auth.ctx;
  const params = await props.params;

  const [history, promotion] = await Promise.all([
    db.selectFrom('product_price_history')
      .leftJoin('admin_accounts', 'admin_accounts.id', 'product_price_history.changed_by')
      .select([
        'product_price_history.id', 'old_price', 'new_price', 'source', 'note',
        'effective_at', 'content_item_id', 'admin_accounts.username as changed_by_username',
      ])
      .where('product_id', '=', params.productId)
      .orderBy('effective_at', 'desc')
      .limit(100)
      .execute(),
    db.selectFrom('promotions')
      .select(['id', 'promo_price', 'previous_price', 'starts_at', 'ends_at', 'status', 'content_item_id'])
      .where('product_id', '=', params.productId)
      .where('status', 'in', ['pending', 'active'])
      .executeTakeFirst(),
  ]);
  return NextResponse.json({ history, open_promotion: promotion ?? null });
}
