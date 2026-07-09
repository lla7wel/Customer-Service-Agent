import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/supabase/db';
import { supabaseStatus } from '@integrations/status';
import { productSelectColumns, toUiCandidate } from '@/lib/product-candidates';

export const runtime = 'nodejs';

/** Lightweight product search used by the inbox product panel + campaign picker. */
export async function GET(req: NextRequest) {
  if (!supabaseStatus().configured) {
    return NextResponse.json({ error: 'integration_not_configured', missing: supabaseStatus().missing }, { status: 503 });
  }
  const supabase = getDb();
  if (!supabase) return NextResponse.json({ rows: [] });

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  const ids = (req.nextUrl.searchParams.get('ids') ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 40);
  let query = supabase
    .from('products')
    .select(productSelectColumns())
    .order('updated_at', { ascending: false })
    .limit(20);
  if (ids.length) query = query.in('id', ids);
  if (q) {
    const like = `%${q}%`;
    query = query.or(
      `libyan_display_name.ilike.${like},arabic_name.ilike.${like},english_name.ilike.${like},source_name.ilike.${like},product_code.ilike.${like},barcode.ilike.${like}`,
    );
  }
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const order = new Map(ids.map((id, i) => [id, i]));
  const rows = (data ?? [])
    .map((p: any) => {
      const c = toUiCandidate(p);
      return { ...c, code: c.product_code, category: p.category };
    })
    .sort((a: any, b: any) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999));
  return NextResponse.json({ rows });
}
