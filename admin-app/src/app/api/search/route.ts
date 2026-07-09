import { NextRequest, NextResponse } from 'next/server';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { getDb } from '@/lib/db';
import { databaseStatus } from '@integrations/status';
import { uiProductQuery, toUiCandidate } from '@/lib/product-candidates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SearchItem = {
  id: string;
  type: 'product' | 'conversation' | 'customer' | 'campaign';
  title: string;
  subtitle: string;
  href: string;
};

export async function GET(req: NextRequest) {
  if (!databaseStatus().configured) {
    return NextResponse.json({ error: 'integration_not_configured', missing: databaseStatus().missing }, { status: 503 });
  }
  const db = getDb();
  if (!db) return NextResponse.json({ rows: [] });

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ rows: [] });
  const like = `%${q}%`;

  const [products, conversations, customers, campaigns] = await Promise.all([
    uiProductQuery(db)
      .where((eb) =>
        eb.or([
          eb('products.libyan_display_name', 'ilike', like), eb('products.arabic_name', 'ilike', like),
          eb('products.english_name', 'ilike', like), eb('products.source_name', 'ilike', like),
          eb('products.product_code', 'ilike', like), eb('products.barcode', 'ilike', like),
        ]),
      )
      .orderBy('products.updated_at', 'desc')
      .limit(5)
      .execute(),
    db.selectFrom('conversations')
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
      .execute(),
    db.selectFrom('customers')
      .select(['id', 'display_name', 'phone', 'external_id'])
      .where((eb) =>
        eb.or([
          eb('display_name', 'ilike', like), eb('first_name', 'ilike', like),
          eb('last_name', 'ilike', like), eb('phone', 'ilike', like), eb('external_id', 'ilike', like),
        ]),
      )
      .orderBy('updated_at', 'desc')
      .limit(5)
      .execute(),
    db.selectFrom('campaigns')
      .select(['id', 'name', 'status', 'type'])
      .where((eb) => eb.or([eb('name', 'ilike', like), eb(eb.cast('status', 'text'), 'ilike', like), eb(eb.cast('type', 'text'), 'ilike', like)]))
      .orderBy('updated_at', 'desc')
      .limit(5)
      .execute(),
  ]);

  const rows: SearchItem[] = [];
  for (const p of products) {
    const c = toUiCandidate(p as any);
    rows.push({
      id: `product:${c.id}`,
      type: 'product',
      title: c.name,
      subtitle: [c.product_code, c.price != null ? `${c.price} د.ل` : null].filter(Boolean).join(' · '),
      href: `/products/${c.id}`,
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
  for (const c of campaigns as any[]) {
    rows.push({
      id: `campaign:${c.id}`,
      type: 'campaign',
      title: c.name,
      subtitle: [c.status, c.type].filter(Boolean).join(' · '),
      href: `/campaigns/${c.id}`,
    });
  }

  return NextResponse.json({ rows: rows.slice(0, 12) });
}
