import { NextRequest, NextResponse } from 'next/server';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { requireAdminApi } from '@/lib/api';
import { canAccessSection } from '@/lib/rbac';
import { uiProductQuery, toUiCandidate } from '@/lib/product-candidates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SearchItem = {
  id: string;
  type: 'product' | 'conversation' | 'customer' | 'content';
  title: string;
  subtitle: string;
  href: string;
};

export async function GET(req: NextRequest) {
  const auth = await requireAdminApi(req);
  if (!auth.ok) return auth.res;
  const { db, admin } = auth.ctx;

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ rows: [] });
  const like = `%${q}%`;

  // Global search never leaks results a role cannot open: each category is
  // gated by the section its links target.
  const canProducts = canAccessSection(admin.role, 'catalog');
  const canInbox = canAccessSection(admin.role, 'inbox');
  const canContent = canAccessSection(admin.role, 'content-studio');

  const [products, conversations, customers, content] = await Promise.all([
    canProducts ? uiProductQuery(db)
      .where((eb) =>
        eb.or([
          eb('products.libyan_display_name', 'ilike', like), eb('products.arabic_name', 'ilike', like),
          eb('products.english_name', 'ilike', like), eb('products.source_name', 'ilike', like),
          eb('products.product_code', 'ilike', like), eb('products.barcode', 'ilike', like),
        ]),
      )
      .orderBy('products.updated_at', 'desc')
      .limit(5)
      .execute() : Promise.resolve([]),
    canInbox ? db.selectFrom('conversations')
      .select(['id', 'status', 'last_message_preview', 'detected_intent', 'last_message_at'])
      .select((eb) => [
        jsonObjectFrom(
          eb.selectFrom('customers').select('display_name').whereRef('customers.id', '=', 'conversations.customer_id'),
        ).as('customers'),
      ])
      .where((eb) =>
        eb.or([
          eb('last_message_preview', 'ilike', like),
          eb('context_summary', 'ilike', like),
          eb('detected_intent', 'ilike', like),
        ]),
      )
      .orderBy('last_message_at', (ob) => ob.desc().nullsLast())
      .limit(5)
      .execute() : Promise.resolve([]),
    canInbox ? db.selectFrom('customers')
      .select(['id', 'display_name', 'phone', 'external_id'])
      .where((eb) =>
        eb.or([
          eb('display_name', 'ilike', like), eb('first_name', 'ilike', like),
          eb('last_name', 'ilike', like), eb('phone', 'ilike', like), eb('external_id', 'ilike', like),
        ]),
      )
      .orderBy('updated_at', 'desc')
      .limit(5)
      .execute() : Promise.resolve([]),
    canContent ? db.selectFrom('content_items')
      .select(['id', 'title', 'status', 'content_type', 'purpose'])
      .where((eb) => eb.or([eb('title', 'ilike', like), eb(eb.cast('status', 'text'), 'ilike', like), eb(eb.cast('purpose', 'text'), 'ilike', like)]))
      .orderBy('updated_at', 'desc')
      .limit(5)
      .execute() : Promise.resolve([]),
  ]);

  const rows: SearchItem[] = [];
  for (const p of products) {
    const c = toUiCandidate(p as any);
    rows.push({
      id: `product:${c.id}`,
      type: 'product',
      title: c.name,
      subtitle: [c.product_code, c.price != null ? `${c.price} د.ل` : null].filter(Boolean).join(' · '),
      href: `/catalog/${c.id}`,
    });
  }
  for (const c of conversations as any[]) {
    rows.push({
      id: `conversation:${c.id}`,
      type: 'conversation',
      title: c.customers?.display_name || c.last_message_preview || `#${c.id.slice(0, 8)}`,
      subtitle: [c.status, c.detected_intent].filter(Boolean).join(' · '),
      href: `/inbox/${c.id}`,
    });
  }

  const customerIds = customers.map((c) => c.id);
  const latestByCustomer = new Map<string, string>();
  if (customerIds.length) {
    const convs = await db
      .selectFrom('conversations')
      .select(['id', 'customer_id', 'last_message_at'])
      .where('customer_id', 'in', customerIds)
      .orderBy('last_message_at', (ob) => ob.desc().nullsLast())
      .limit(20)
      .execute();
    for (const conv of convs) {
      if (conv.customer_id && !latestByCustomer.has(conv.customer_id)) latestByCustomer.set(conv.customer_id, conv.id);
    }
  }
  for (const c of customers as any[]) {
    rows.push({
      id: `customer:${c.id}`,
      type: 'customer',
      title: c.display_name || c.phone || c.external_id || c.id.slice(0, 8),
      subtitle: [c.phone, c.external_id].filter(Boolean).join(' · '),
      href: latestByCustomer.has(c.id) ? `/inbox/${latestByCustomer.get(c.id)}` : '/inbox',
    });
  }
  for (const c of content as any[]) {
    rows.push({
      id: `content:${c.id}`,
      type: 'content',
      title: c.title || (c.content_type === 'story' ? 'Story' : 'Post'),
      subtitle: [c.status, c.purpose].filter(Boolean).join(' · '),
      href: `/content-studio/${c.id}`,
    });
  }

  return NextResponse.json({ rows: rows.slice(0, 12) });
}
