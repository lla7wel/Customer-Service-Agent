import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { databaseStatus } from '@integrations/status';
import { uiProductQuery, toUiCandidate } from '@/lib/product-candidates';

export const runtime = 'nodejs';

const SEARCH_COLUMNS = [
  'libyan_display_name', 'arabic_name', 'english_name', 'source_name', 'product_code', 'barcode',
] as const;

/** Lightweight product search used by the inbox product panel + Content Studio picker. */
export async function GET(req: NextRequest) {
  if (!databaseStatus().configured) {
    return NextResponse.json({ error: 'integration_not_configured', missing: databaseStatus().missing }, { status: 503 });
  }
  const db = getDb();
  if (!db) return NextResponse.json({ rows: [] });

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  const ids = (req.nextUrl.searchParams.get('ids') ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 40);
  let query = uiProductQuery(db).orderBy('updated_at', 'desc').limit(20);
  if (ids.length) query = query.where('products.id', 'in', ids);
  if (q) {
    const like = `%${q}%`;
    query = query.where((eb) => eb.or(SEARCH_COLUMNS.map((c) => eb(`products.${c}`, 'ilike', like))));
  }
  let data: any[];
  try {
    data = await query.execute();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'search_failed' }, { status: 500 });
  }

  const order = new Map(ids.map((id, i) => [id, i]));
  const rows = data
    .map((p: any) => {
      const c = toUiCandidate(p);
      return { ...c, code: c.product_code, category: p.category };
    })
    .sort((a: any, b: any) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999));
  return NextResponse.json({ rows });
}
