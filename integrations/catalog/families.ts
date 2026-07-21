/**
 * Product families — automatic initial grouping of genuine variations.
 *
 * The bootstrap groups products whose names share a base after size/color/
 * piece-count tokens are stripped (e.g. "RANFORCE DUVET SET 160x220 WHITE" and
 * "RANFORCE DUVET SET 200x220 GREY" → one family, two variants). Grouping is
 * conservative: only within the same category and only when the stripped base
 * is meaningful. There is NO review queue: admins correct in place, and a
 * corrected product (family_locked=true) is never regrouped automatically.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';

const SIZE_RE = /\b\d{2,3}\s*[x×*]\s*\d{2,3}(\s*cm)?\b/gi;
const PIECES_RE = /\b(\d+)\s*(pcs?|pieces?|parça|قطعة|قطع)\b/gi;
const SINGLE_DIM_RE = /\b\d{2,3}\s*cm\b/gi;
const COLOR_WORDS = [
  'white','black','grey','gray','beige','cream','ecru','blue','navy','red','green','yellow','pink','purple','lilac','brown','anthracite','petrol','turquoise','mint','gold','silver','fuchsia','coral','terracotta','mustard','khaki','bordeaux','burgundy','indigo','off white',
  'أبيض','ابيض','أسود','اسود','رمادي','بيج','كريمي','أزرق','ازرق','كحلي','أحمر','احمر','أخضر','اخضر','أصفر','اصفر','وردي','بنفسجي','بني','ذهبي','فضي','تركواز','خردلي','عنابي',
  'beyaz','siyah','gri','bej','krem','mavi','lacivert','kırmızı','yeşil','sarı','pembe','mor','kahverengi','antrasit','ekru',
];
const COLOR_RE = new RegExp(`\\b(${COLOR_WORDS.join('|')})\\b`, 'gi');

/** Normalized family key from a product name; '' when nothing meaningful is left. */
export function familyKeyFromName(name: string | null | undefined): string {
  if (!name) return '';
  const stripped = name
    .replace(SIZE_RE, ' ')
    .replace(PIECES_RE, ' ')
    .replace(SINGLE_DIM_RE, ' ')
    .replace(COLOR_RE, ' ')
    .replace(/[()\-_,./]+/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return stripped.length >= 6 ? stripped : '';
}

/** The variant label = what familyKeyFromName stripped (size/color/pieces). */
export function variantLabelFromName(name: string | null | undefined): string {
  if (!name) return '';
  const parts: string[] = [];
  for (const re of [SIZE_RE, PIECES_RE, SINGLE_DIM_RE, COLOR_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(name))) parts.push(m[0].trim());
  }
  return [...new Set(parts)].join(' · ');
}

export interface FamilyBootstrapResult {
  familiesCreated: number;
  productsGrouped: number;
  skippedLocked: number;
}

export async function bootstrapFamilies(db: Kysely<DB>): Promise<FamilyBootstrapResult> {
  const products = await db
    .selectFrom('products')
    .select(['id', 'english_name', 'arabic_name', 'libyan_display_name', 'category', 'family_id', 'family_locked'])
    .where('status', '=', 'active')
    .execute();

  const groups = new Map<string, { name: string; category: string | null; members: typeof products }>();
  for (const p of products) {
    const base = familyKeyFromName(p.english_name ?? p.libyan_display_name ?? p.arabic_name);
    if (!base) continue;
    const key = `${p.category ?? ''}::${base}`;
    const g = groups.get(key) ?? { name: base, category: p.category ?? null, members: [] as typeof products };
    g.members.push(p);
    groups.set(key, g);
  }

  let familiesCreated = 0;
  let productsGrouped = 0;
  let skippedLocked = 0;

  for (const [key, group] of groups) {
    if (group.members.length < 2) continue; // a family needs genuine variations
    const movable = group.members.filter((m) => !m.family_locked);
    skippedLocked += group.members.length - movable.length;
    if (!movable.length) continue;

    const family = await db
      .insertInto('product_families')
      .values({ family_key: key.slice(0, 500), name: group.name, kind: 'auto' })
      .onConflict((oc) => oc.column('family_key').doUpdateSet({ name: group.name }))
      .returning('id')
      .executeTakeFirst();
    if (!family) continue;
    familiesCreated++;

    for (const member of movable) {
      if (member.family_id === family.id) continue;
      const label = variantLabelFromName(member.english_name ?? member.libyan_display_name ?? member.arabic_name);
      await db
        .updateTable('products')
        .set({ family_id: family.id, ...(label ? { variant_label: label } : {}) })
        .where('id', '=', member.id)
        .where('family_locked', '=', false)
        .execute();
      productsGrouped++;
    }
  }
  return { familiesCreated, productsGrouped, skippedLocked };
}
