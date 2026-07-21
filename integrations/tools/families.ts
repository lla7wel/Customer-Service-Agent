/**
 * Family/variant/relation read tools — how the assistant answers "عندكم مفارش
 * سرير؟" with a compact, truthful range summary instead of a catalog dump.
 */
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';
import { productSelect, activePriced, toCandidate } from './products';
import type { ProductCandidate, ToolResult } from './types';

export interface FamilySummary {
  family_id: string;
  name: string;
  name_ar: string | null;
  member_count: number;
  min_price: number | null;
  max_price: number | null;
  sample_variants: string[];
}

/** Compact family range summaries matching search terms (verified data only). */
export async function searchFamilies(db: Kysely<DB>, terms: string[], limit = 6): Promise<ToolResult<FamilySummary[]>> {
  const clean = Array.from(new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))).slice(0, 8);
  if (!clean.length) return { ok: true, data: [] };
  const q = clean.join(' ');
  const rows = await sql<{
    family_id: string; name: string; name_ar: string | null;
    member_count: number; min_price: number | null; max_price: number | null; sample_variants: string[] | null;
  }>`
    select f.id as family_id, f.name, f.name_ar,
           count(p.id)::int as member_count,
           min(p.active_price) as min_price,
           max(p.active_price) as max_price,
           (array_agg(distinct p.variant_label) filter (where p.variant_label is not null))[1:4] as sample_variants
      from product_families f
      join products p on p.family_id = f.id
     where p.status = 'active' and p.active_price is not null
       and (
         p.search_tsv @@ websearch_to_tsquery('simple', ${q})
         or f.name ilike ${'%' + clean[0] + '%'}
         or coalesce(f.name_ar, '') ilike ${'%' + clean[0] + '%'}
       )
     group by f.id, f.name, f.name_ar
     order by count(p.id) desc
     limit ${limit}
  `.execute(db);
  return {
    ok: true,
    data: rows.rows.map((r) => ({
      family_id: r.family_id,
      name: r.name,
      name_ar: r.name_ar,
      member_count: Number(r.member_count),
      min_price: r.min_price != null ? Number(r.min_price) : null,
      max_price: r.max_price != null ? Number(r.max_price) : null,
      sample_variants: r.sample_variants ?? [],
    })),
  };
}

/** Active priced members of one family (the sellable variants). */
export async function getFamilyProducts(db: Kysely<DB>, familyId: string, limit = 12): Promise<ToolResult<ProductCandidate[]>> {
  const rows = await activePriced(productSelect(db))
    .where('products.family_id', '=', familyId)
    .limit(limit)
    .execute();
  return { ok: true, data: rows.map((p: any) => toCandidate(p, 0.7, p.variant_label ? `variant: ${p.variant_label}` : 'family member')) };
}

/**
 * Related products for one product: same-family variants first, then explicit
 * admin/auto relations (set members, complementary items). Never unrelated.
 */
export async function getRelatedProducts(db: Kysely<DB>, productId: string, limit = 8): Promise<ToolResult<ProductCandidate[]>> {
  const base = await db
    .selectFrom('products')
    .select(['id', 'family_id'])
    .where('id', '=', productId)
    .executeTakeFirst();
  if (!base) return { ok: true, data: [] };

  const out: ProductCandidate[] = [];
  if (base.family_id) {
    const siblings = await activePriced(productSelect(db))
      .where('products.family_id', '=', base.family_id)
      .where('products.id', '!=', productId)
      .limit(limit)
      .execute();
    out.push(...siblings.map((p: any) => toCandidate(p, 0.6, p.variant_label ? `variant: ${p.variant_label}` : 'same family')));
  }
  if (out.length < limit) {
    const related = await db
      .selectFrom('product_relations')
      .select(['related_product_id', 'relation_type'])
      .where('product_id', '=', productId)
      .execute();
    const ids = related.map((r) => r.related_product_id).filter((id) => !out.some((c) => c.id === id));
    if (ids.length) {
      const rows = await activePriced(productSelect(db)).where('products.id', 'in', ids).limit(limit - out.length).execute();
      const typeById = new Map(related.map((r) => [r.related_product_id, r.relation_type]));
      out.push(...rows.map((p: any) => toCandidate(p, 0.5, String(typeById.get(p.id) ?? 'related'))));
    }
  }
  return { ok: true, data: out.slice(0, limit) };
}
