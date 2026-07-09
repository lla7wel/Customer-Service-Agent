import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/supabase/db';
import { supabaseStatus } from '@integrations/status';
import { productSelectColumns, toUiCandidate } from '@/lib/product-candidates';

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
  if (!supabaseStatus().configured) {
    return NextResponse.json({ error: 'integration_not_configured', missing: supabaseStatus().missing }, { status: 503 });
  }
  const db = getDb();
  if (!db) return NextResponse.json({ rows: [] });

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ rows: [] });
  const like = `%${q.replace(/[%,()]/g, ' ')}%`;

  const [products, conversations, customers, campaigns] = await Promise.all([
    db.from('products')
      .select(productSelectColumns())
      .or(`libyan_display_name.ilike.${like},arabic_name.ilike.${like},english_name.ilike.${like},source_name.ilike.${like},product_code.ilike.${like},barcode.ilike.${like}`)
      .order('updated_at', { ascending: false })
      .limit(5),
    db.from('conversations')
      .select('id,status,last_message_preview,detected_intent,last_message_at,customers(display_name)')
      .or(`last_message_preview.ilike.${like},context_summary.ilike.${like},detected_intent.ilike.${like}`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(5),
    db.from('customers')
      .select('id,display_name,phone,external_id')
      .or(`display_name.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like},external_id.ilike.${like}`)
      .order('updated_at', { ascending: false })
      .limit(5),
    db.from('campaigns')
      .select('id,name,status,type')
      .or(`name.ilike.${like},status.ilike.${like},type.ilike.${like}`)
      .order('updated_at', { ascending: false })
      .limit(5),
  ]);

  const rows: SearchItem[] = [];
  for (const p of products.data ?? []) {
    const c = toUiCandidate(p as any);
    rows.push({
      id: `product:${c.id}`,
      type: 'product',
      title: c.name,
      subtitle: [c.product_code, c.price != null ? `${c.price} د.ل` : null].filter(Boolean).join(' · '),
      href: `/products/${c.id}`,
    });
  }
  for (const c of (conversations.data ?? []) as any[]) {
    rows.push({
      id: `conversation:${c.id}`,
      type: 'conversation',
      title: c.customers?.display_name || c.last_message_preview || `#${c.id.slice(0, 8)}`,
      subtitle: [c.status, c.detected_intent].filter(Boolean).join(' · '),
      href: `/inbox/${c.id}`,
    });
  }

  const customerIds = (customers.data ?? []).map((c: any) => c.id);
  const latestByCustomer = new Map<string, string>();
  if (customerIds.length) {
    const { data: convs } = await db
      .from('conversations')
      .select('id,customer_id,last_message_at')
      .in('customer_id', customerIds)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(20);
    for (const conv of (convs ?? []) as any[]) if (!latestByCustomer.has(conv.customer_id)) latestByCustomer.set(conv.customer_id, conv.id);
  }
  for (const c of (customers.data ?? []) as any[]) {
    rows.push({
      id: `customer:${c.id}`,
      type: 'customer',
      title: c.display_name || c.phone || c.external_id || c.id.slice(0, 8),
      subtitle: [c.phone, c.external_id].filter(Boolean).join(' · '),
      href: latestByCustomer.has(c.id) ? `/inbox/${latestByCustomer.get(c.id)}` : '/inbox',
    });
  }
  for (const c of (campaigns.data ?? []) as any[]) {
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
