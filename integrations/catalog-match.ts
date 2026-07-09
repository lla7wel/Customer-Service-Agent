/**
 * Catalog image matching helpers.
 *
 * CSV/admin products are the priced source of truth. Scraper products are only
 * source/reference rows with images. This module scores whether a scraper-only
 * product is likely the same item as an active CSV product without touching any
 * customer-facing fields or prices.
 */

export type MatchConfidenceLevel = 'high' | 'medium' | 'low' | 'none';

export interface MatchableProduct {
  id: string;
  product_code?: string | null;
  barcode?: string | null;
  source_name?: string | null;
  english_name?: string | null;
  arabic_name?: string | null;
  libyan_display_name?: string | null;
  category?: string | null;
  search_keywords?: string[] | null;
  arabic_keywords?: string[] | null;
  raw?: unknown;
}

export interface MatchCandidate extends MatchableProduct {
  image?: string | null;
  image_count?: number;
}

export interface PreparedMatchProduct<T extends MatchableProduct = MatchableProduct> {
  item: T;
  profile: ProductMatchProfile;
}

interface MatchEvidence {
  exactIdentity: boolean;
  sharedCodeFamily: boolean;
  sharedDimension: boolean;
  sharedSpecificFamily: boolean;
  sharedColor: boolean;
  sharedNameMeaning: boolean;
  sharedDistinctiveName: boolean;
  conflicting: boolean;
}

export interface CatalogMatchScore {
  score: number;
  level: MatchConfidenceLevel;
  signals: string[];
  shared: string[];
  reason: string;
  evidence: MatchEvidence;
}

export interface CatalogMatchSuggestion extends CatalogMatchScore {
  scraper_product_id: string;
  source_name: string | null;
  image: string | null;
  image_count: number;
  confidence: number;
}

export interface MatchSummary {
  checked: number;
  suggestionsGenerated: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  noConfidence: number;
  wouldAutoAttachProducts: number;
  wouldAutoAttachImages: number;
  wouldSendToReview: number;
  samples: Array<{
    csvProductId: string;
    csvName: string;
    csvCode: string | null;
    scraperProductId: string;
    scraperName: string | null;
    confidence: number;
    level: MatchConfidenceLevel;
    images: number;
    reason: string;
  }>;
}

interface ProductMatchProfile {
  code: string | null;
  codeFamilies: Set<string>;
  barcode: string | null;
  tokens: Set<string>;
  strongTokens: Set<string>;
  concepts: Set<string>;
  dimensions: Set<string>;
  volumes: Set<string>;
  colors: Set<string>;
  families: Set<string>;
  materials: Set<string>;
  pieces: Set<string>;
  persons: Set<string>;
  rejectedScraperIds: Set<string>;
}

const STOP = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'cm', 'cm2', 'for', 'from', 'g', 'gr',
  'home', 'in', 'is', 'kg', 'l', 'lt', 'mm', 'ml', 'no', 'of', 'on', 'or',
  'pc', 'pcs', 'piece', 'pieces', 'set', 'size', 'the', 'to', 've', 'with', 'x',
  'english', 'eh', 'libya', 'turkiye', 'turkey',
  'basic', 'bloom', 'deluxe', 'floral', 'garden', 'line', 'oxford', 'plain', 'plus',
  'super', 'touch', 'travel',
  'adet', 'ad', 'cm.', 'icin', 'ile', 'kisilik', 'li', 'lu', 'lü', 'parca',
  'parça', 'veya',
]);

const COLOR_WORDS: Record<string, string[]> = {
  acik: ['light'],
  amber: ['amber'],
  antrasit: ['anthracite', 'gray'],
  bej: ['beige'],
  beyaz: ['white'],
  bordo: ['burgundy', 'red'],
  camel: ['camel', 'beige'],
  ekru: ['ecru', 'cream'],
  ecru: ['ecru', 'cream'],
  fildisi: ['ivory', 'cream'],
  gold: ['gold'],
  gri: ['gray'],
  gumus: ['silver', 'gray'],
  haki: ['khaki', 'green'],
  kahve: ['brown'],
  kahverengi: ['brown'],
  karamel: ['caramel', 'brown'],
  hardal: ['yellow'],
  kirmizi: ['red'],
  koyu: ['dark'],
  krem: ['cream'],
  lacivert: ['navy', 'blue'],
  lila: ['lilac', 'purple'],
  mavi: ['blue'],
  mor: ['purple'],
  pembe: ['pink'],
  pudra: ['powder', 'pink'],
  sari: ['yellow'],
  seledon: ['green'],
  seffaf: ['transparent'],
  siyah: ['black'],
  tas: ['stone', 'gray'],
  turkuaz: ['turquoise', 'blue'],
  turuncu: ['orange'],
  fusya: ['fuchsia', 'pink'],
  fuşya: ['fuchsia', 'pink'],
  yesil: ['green'],
  blue: ['blue'],
  celadon: ['green'],
  navy: ['navy', 'blue'],
  white: ['white'],
  black: ['black'],
  gray: ['gray'],
  grey: ['gray'],
  silver: ['silver', 'gray'],
  pink: ['pink'],
  fuchsia: ['fuchsia', 'pink'],
  powder: ['powder', 'pink'],
  red: ['red'],
  burgundy: ['burgundy', 'red'],
  salmon: ['pink', 'orange'],
  green: ['green'],
  khaki: ['khaki', 'green'],
  damson: ['purple'],
  yellow: ['yellow'],
  mustard: ['yellow'],
  orange: ['orange'],
  terracotta: ['orange', 'brown'],
  purple: ['purple'],
  lilac: ['lilac', 'purple'],
  beige: ['beige'],
  cream: ['cream'],
  ivory: ['ivory', 'cream'],
  brown: ['brown'],
  bronze: ['brown'],
  natural: ['natural'],
  pebble: ['gray'],
  sage: ['green'],
  indigo: ['blue'],
  transparent: ['transparent'],
  somon: ['pink', 'orange'],
  // Arabic keywords used by the CSV catalog.
  ازرق: ['blue'],
  أزرق: ['blue'],
  كحلي: ['navy', 'blue'],
  ابيض: ['white'],
  أبيض: ['white'],
  اسود: ['black'],
  أسود: ['black'],
  رمادي: ['gray'],
  فضي: ['silver', 'gray'],
  وردي: ['pink'],
  زهري: ['pink'],
  احمر: ['red'],
  أحمر: ['red'],
  اخضر: ['green'],
  أخضر: ['green'],
  اصفر: ['yellow'],
  أصفر: ['yellow'],
  برتقالي: ['orange'],
  بنفسجي: ['purple'],
  بيج: ['beige'],
  كريمي: ['cream'],
  بني: ['brown'],
  ذهبي: ['gold'],
};

const FAMILY_WORDS: Record<string, string[]> = {
  alez: ['mattress_protector', 'bedding'],
  ayak: ['foot'],
  bardak: ['cup', 'drinkware'],
  battaniye: ['blanket', 'bedding'],
  biberlik: ['pepper_shaker', 'kitchen'],
  bicak: ['knife', 'cutlery'],
  bornoz: ['bathrobe', 'bath'],
  carsaf: ['sheet', 'bedding'],
  catal: ['fork', 'cutlery'],
  cerezlik: ['snack_bowl', 'serveware'],
  degirmen: ['grinder', 'kitchen'],
  dis: ['toothbrush', 'bath'],
  fincan: ['cup', 'coffee_cup', 'drinkware'],
  fircasi: ['brush'],
  hali: ['rug', 'floor'],
  havlu: ['towel', 'bath'],
  kase: ['bowl', 'serveware'],
  kasik: ['spoon', 'cutlery'],
  kahve: ['coffee'],
  kavanoz: ['jar', 'storage'],
  kupa: ['mug', 'drinkware'],
  kirlent: ['cushion', 'pillow'],
  masa: ['table'],
  mat: ['mat', 'floor'],
  mum: ['candle', 'decor'],
  nevresim: ['duvet_cover', 'bedding'],
  oda: ['room'],
  ortusu: ['cover'],
  oyun: ['game'],
  paspas: ['mat', 'floor'],
  perde: ['curtain'],
  pike: ['pique', 'blanket', 'bedding'],
  runner: ['runner', 'table'],
  sabunluk: ['soap_dispenser', 'bath'],
  saklama: ['storage'],
  sepet: ['basket', 'storage'],
  surahi: ['jug', 'drinkware'],
  tabak: ['plate', 'serveware'],
  takim: ['set'],
  takimi: ['set'],
  tava: ['pan', 'kitchen'],
  tepsi: ['tray', 'serveware'],
  tencere: ['pot', 'kitchen'],
  tuzluk: ['salt_shaker', 'kitchen'],
  vazo: ['vase', 'decor'],
  yastik: ['pillow', 'bedding'],
  yuz: ['face'],
  duvet: ['duvet_cover', 'bedding'],
  cover: ['cover'],
  bedding: ['bedding'],
  sheet: ['sheet', 'bedding'],
  towel: ['towel', 'bath'],
  bath: ['bath'],
  bathrobe: ['bathrobe', 'bath'],
  robe: ['bathrobe', 'bath'],
  blanket: ['blanket', 'bedding'],
  pillow: ['pillow', 'bedding'],
  cushion: ['cushion', 'pillow'],
  mattress: ['mattress_protector', 'bedding'],
  protector: ['mattress_protector', 'bedding'],
  cup: ['cup', 'drinkware'],
  coffee: ['coffee'],
  jar: ['jar', 'storage'],
  jug: ['jug', 'drinkware'],
  mug: ['mug', 'drinkware'],
  plate: ['plate', 'serveware'],
  bowl: ['bowl', 'serveware'],
  tray: ['tray', 'serveware'],
  fork: ['fork', 'cutlery'],
  spoon: ['spoon', 'cutlery'],
  knife: ['knife', 'cutlery'],
  pot: ['pot', 'kitchen'],
  pan: ['pan', 'kitchen'],
  grinder: ['grinder', 'kitchen'],
  shaker: ['shaker', 'kitchen'],
  storage: ['storage'],
  organizer: ['organizer', 'storage'],
  basket: ['basket', 'storage'],
  vase: ['vase', 'decor'],
  candle: ['candle', 'decor'],
  diffuser: ['fragrance', 'decor'],
  fragrance: ['fragrance', 'decor'],
  rug: ['rug', 'floor'],
  curtain: ['curtain'],
  game: ['game'],
  منشفة: ['towel', 'bath'],
  مناشف: ['towel', 'bath'],
  فوطة: ['towel', 'bath'],
  فوط: ['towel', 'bath'],
  حمام: ['bath'],
  وجه: ['face'],
  قدم: ['foot'],
  شرشف: ['sheet', 'bedding'],
  ملاية: ['sheet', 'bedding'],
  لحاف: ['duvet_cover', 'bedding'],
  بطانية: ['blanket', 'bedding'],
  مخدة: ['pillow', 'bedding'],
  وسادة: ['pillow', 'bedding'],
  كوب: ['cup', 'drinkware'],
  فناجين: ['cup', 'coffee_cup', 'drinkware'],
  فنجان: ['cup', 'coffee_cup', 'drinkware'],
  مج: ['mug', 'drinkware'],
  طبق: ['plate', 'serveware'],
  اطباق: ['plate', 'serveware'],
  أطباق: ['plate', 'serveware'],
  صحن: ['plate', 'serveware'],
  زبدية: ['bowl', 'serveware'],
  وعاء: ['bowl', 'serveware'],
  صينية: ['tray', 'serveware'],
  شوكة: ['fork', 'cutlery'],
  ملعقة: ['spoon', 'cutlery'],
  سكين: ['knife', 'cutlery'],
  قدر: ['pot', 'kitchen'],
  مقلاة: ['pan', 'kitchen'],
  مطحنة: ['grinder', 'kitchen'],
  مزهرية: ['vase', 'decor'],
  شمعة: ['candle', 'decor'],
  سجادة: ['rug', 'floor'],
  دعاسة: ['mat', 'floor'],
  ستارة: ['curtain'],
};

const GENERIC_FAMILIES = new Set([
  'bath',
  'bedding',
  'coffee',
  'cover',
  'cutlery',
  'decor',
  'drinkware',
  'floor',
  'kitchen',
  'mat',
  'room',
  'serveware',
  'set',
  'storage',
  'table',
]);

const PHRASE_FAMILIES: Array<[RegExp, string[]]> = [
  [/\boda\s+kokusu\b/g, ['fragrance', 'decor']],
  [/\bkahve\s+fincan/g, ['coffee_cup', 'cup', 'drinkware']],
  [/\btuzluk\s+biberlik\b/g, ['salt_pepper_shaker', 'kitchen']],
  [/\bnevresim\s+takim/g, ['duvet_cover', 'bedding', 'set']],
  [/\byuz\s+havlu/g, ['face_towel', 'towel', 'bath']],
  [/\bbanyo\s+havlu/g, ['bath_towel', 'towel', 'bath']],
  [/\bayak\s+havlu/g, ['foot_towel', 'towel', 'bath']],
  [/\bduvet\s+cover\b/g, ['duvet_cover', 'bedding']],
  [/\bbath\s+towel\b/g, ['bath_towel', 'towel', 'bath']],
  [/\bbath\s+mat\b/g, ['bath_mat', 'mat', 'bath']],
  [/\bbanyo\s+paspas/g, ['bath_mat', 'mat', 'bath']],
  [/\bkapi\s+onu\s+paspas/g, ['door_mat', 'mat', 'floor']],
  [/\bface\s+towel\b/g, ['face_towel', 'towel', 'bath']],
  [/\bcoffee\s+cup/g, ['coffee_cup', 'cup', 'drinkware']],
  [/\bcam\s+surahi/g, ['jug', 'drinkware']],
  [/\bglass\s+jug\b/g, ['jug', 'drinkware']],
  [/\btencere\s+set/g, ['pot_set', 'pot', 'kitchen', 'set']],
  [/\bpot\s+set\b/g, ['pot_set', 'pot', 'kitchen', 'set']],
];

const MATERIAL_WORDS: Record<string, string[]> = {
  ahsap: ['wood'],
  bone: ['bone_china'],
  cam: ['glass'],
  china: ['bone_china'],
  cotton: ['cotton'],
  metal: ['metal'],
  pamuk: ['cotton'],
  porselen: ['porcelain'],
  porcelain: ['porcelain'],
  saten: ['satin'],
  satin: ['satin'],
  seramik: ['ceramic'],
  ceramic: ['ceramic'],
  velvet: ['velvet'],
  wood: ['wood'],
};

const CONCEPT_WORDS: Record<string, string[]> = {
  akrilik: ['acrylic'],
  acrylic: ['acrylic'],
  bambu: ['bamboo'],
  bamboo: ['bamboo'],
  baskili: ['printed'],
  printed: ['printed'],
  jakarli: ['jacquard'],
  jacquard: ['jacquard'],
  desenli: ['patterned'],
  patterned: ['patterned'],
  cizgili: ['stripe'],
  stripe: ['stripe'],
  striped: ['stripe'],
  kareli: ['checkered'],
  chequer: ['checkered'],
  chequered: ['checkered'],
  checkered: ['checkered'],
  kolay: ['easy_iron'],
  utulenir: ['easy_iron'],
  iron: ['easy_iron'],
  tek: ['single'],
  single: ['single'],
  cift: ['double'],
  double: ['double'],
  king: ['king'],
  queen: ['queen'],
  modern: ['modern'],
  square: ['square'],
  kare: ['square'],
  round: ['round'],
  yuvarlak: ['round'],
  rectangular: ['rectangular'],
  dikdortgen: ['rectangular'],
  mosaic: ['mosaic'],
  mozaik: ['mosaic'],
  soft: ['soft'],
  silky: ['silky'],
  yumusak: ['soft'],
  pelus: ['plush'],
  plush: ['plush'],
  furry: ['furry'],
  premium: ['premium'],
  mini: ['mini'],
  microfiber: ['microfiber'],
  mikrofiber: ['microfiber'],
  polyester: ['polyester'],
  polycotton: ['polycotton'],
  paper: ['paper_thread'],
  kagit: ['paper_thread'],
  thread: ['paper_thread'],
  ip: ['paper_thread'],
  dekoratif: ['decorative'],
  decorative: ['decorative'],
  koltuk: ['sofa_throw'],
  sofa: ['sofa_throw'],
  throw: ['sofa_throw'],
  sali: ['throw'],
  kilifi: ['cover_case'],
  case: ['cover_case'],
  pillowcase: ['pillowcase'],
  pillowcases: ['pillowcase'],
  reversible: ['double_sided'],
  tarafli: ['double_sided'],
  chic: ['chic'],
  elegance: ['elegance'],
  elegans: ['elegance'],
  summer: ['summer'],
  yaz: ['summer'],
  yazlik: ['summer'],
};

const PHRASE_CONCEPTS: Array<[RegExp, string[]]> = [
  [/\bkolay\s+utulenir\b/g, ['easy_iron']],
  [/\beasy\s+iron\b/g, ['easy_iron']],
  [/\bkagit\s+ip\b/g, ['paper_thread']],
  [/\bpaper\s+thread\b/g, ['paper_thread']],
  [/\bkoltuk\s+sali\b/g, ['sofa_throw']],
  [/\bsofa\s+throw\b/g, ['sofa_throw']],
  [/\bcift\s+tarafli\b/g, ['double_sided']],
  [/\bdouble\s+sided\b/g, ['double_sided']],
  [/\byastik\s+kilifi\b/g, ['pillowcase', 'cover_case']],
  [/\bpillow\s*case\b/g, ['pillowcase', 'cover_case']],
  [/\bkirlent\s+kilifi\b/g, ['cushion_cover', 'cover_case']],
  [/\bcushion\s+cover\b/g, ['cushion_cover', 'cover_case']],
  [/\bsoft\s+touch\b/g, ['soft']],
  [/\bsuper\s+soft\b/g, ['soft']],
];

const GENERIC_CONCEPTS = new Set([
  'acrylic',
  'checkered',
  'decorative',
  'double',
  'easy_iron',
  'furry',
  'king',
  'microfiber',
  'mini',
  'modern',
  'mosaic',
  'patterned',
  'pillowcase',
  'plush',
  'polycotton',
  'polyester',
  'premium',
  'printed',
  'queen',
  'rectangular',
  'round',
  'single',
  'soft',
  'jacquard',
  'silky',
  'square',
  'summer',
  'stripe',
  'cover_case',
  'cushion_cover',
]);

const MUTUALLY_EXCLUSIVE_CONCEPT_GROUPS = [
  new Set(['single', 'double', 'king', 'queen']),
];

const COLOR_DETAIL_WORDS = new Set(['dark', 'light', 'powder', 'stone']);

function comparableColors(colors: Set<string>): Set<string> {
  return new Set([...colors].filter((color) => !COLOR_DETAIL_WORDS.has(color)));
}

export function normalizeCode(code: string | null | undefined): string {
  const compact = (code ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return compact.replace(/^0+/, '') || compact;
}

export function normalizeBarcode(barcode: string | null | undefined): string | null {
  const compact = (barcode ?? '').replace(/\D+/g, '').replace(/^0+/, '');
  return compact || null;
}

export function displayProductName(p: MatchableProduct): string {
  return (
    p.libyan_display_name ||
    p.arabic_name ||
    p.english_name ||
    p.product_code ||
    p.source_name ||
    p.id
  );
}

export function rejectedScraperIds(raw: unknown): Set<string> {
  if (!raw || typeof raw !== 'object') return new Set();
  const value = (raw as { catalog_match_rejected?: unknown }).catalog_match_rejected;
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value
      .map((x) => {
        if (typeof x === 'string') return x;
        if (x && typeof x === 'object') {
          return (x as { scraper_product_id?: unknown }).scraper_product_id;
        }
        return null;
      })
      .filter((x): x is string => typeof x === 'string' && x.length > 0),
  );
}

function foldText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[şŞ]/g, 's')
    .replace(/[üÜ]/g, 'u')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u064B-\u065F\u0670]/g, '');
}

function textForProfile(p: MatchableProduct): string {
  return [
    p.libyan_display_name,
    p.arabic_name,
    p.english_name,
    p.source_name,
    p.category,
    (p.search_keywords ?? []).join(' '),
    (p.arabic_keywords ?? []).join(' '),
  ]
    .filter(Boolean)
    .join(' ');
}

function words(text: string): string[] {
  return foldText(text)
    .replace(/[^\p{L}\p{N}x×]+/gu, ' ')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2 && !STOP.has(x));
}

function addAll(target: Set<string>, values: Iterable<string>, prefix = '') {
  for (const value of values) {
    const v = value.trim();
    if (v) target.add(prefix ? `${prefix}:${v}` : v);
  }
}

function codeFamilies(code: string | null): Set<string> {
  const out = new Set<string>();
  if (!code) return out;
  if (code.length >= 6) out.add(code);
  if (code.length > 3) out.add(code.slice(0, -3));
  if (code.length > 2) out.add(code.slice(0, -2));
  if (code.length > 8) out.add(code.slice(0, 8));
  if (code.length > 7) out.add(code.slice(0, 7));
  return out;
}

function extractDimensions(text: string): Set<string> {
  const out = new Set<string>();
  const folded = foldText(text);
  for (const m of folded.matchAll(/(\d{1,4})\s*[x×]\s*(\d{1,4})(?:\s*[x×]\s*(\d{1,4}))?/g)) {
    const parts = [m[1], m[2], m[3]].filter(Boolean);
    out.add(parts.join('x'));
    if (parts.length === 2) out.add([...parts].sort((a, b) => Number(a) - Number(b)).join('x'));
  }
  return out;
}

function extractUnitValues(text: string, units: string[]): Set<string> {
  const out = new Set<string>();
  const folded = foldText(text);
  const unitPattern = units.join('|');
  const re = new RegExp(`(\\d{1,4}(?:[,.]\\d{1,3})?)\\s*(${unitPattern})\\b`, 'g');
  for (const m of folded.matchAll(re)) out.add(`${m[1].replace(',', '.').replace(/\\.0+$/, '')}${m[2]}`);
  return out;
}

function extractCounts(text: string, labels: string[]): Set<string> {
  const out = new Set<string>();
  const folded = foldText(text);
  const labelPattern = labels.join('|');
  const re = new RegExp(`(\\d{1,3})\\s*(${labelPattern})\\b`, 'g');
  for (const m of folded.matchAll(re)) out.add(m[1]);
  return out;
}

export function prepareMatchProduct<T extends MatchableProduct>(item: T): PreparedMatchProduct<T> {
  const text = textForProfile(item);
  const folded = foldText(text);
  const tokenList = words(text);
  const tokens = new Set<string>();
  const strongTokens = new Set<string>();
  const concepts = new Set<string>();
  const colors = new Set<string>();
  const families = new Set<string>();
  const materials = new Set<string>();

  for (const token of tokenList) {
    tokens.add(token);
    if (token.length >= 4 && !/^\d+$/.test(token)) strongTokens.add(token);

    const color = COLOR_WORDS[token];
    if (color) addAll(colors, color);

    const family = FAMILY_WORDS[token];
    if (family) addAll(families, family);

    const material = MATERIAL_WORDS[token];
    if (material) addAll(materials, material);

    const concept = CONCEPT_WORDS[token];
    if (concept) addAll(concepts, concept);
  }

  for (const [phrase, family] of PHRASE_FAMILIES) {
    if (phrase.test(folded)) addAll(families, family);
    phrase.lastIndex = 0;
  }
  for (const [phrase, concept] of PHRASE_CONCEPTS) {
    if (phrase.test(folded)) addAll(concepts, concept);
    phrase.lastIndex = 0;
  }

  return {
    item,
    profile: {
      code: normalizeCode(item.product_code),
      codeFamilies: codeFamilies(normalizeCode(item.product_code)),
      barcode: normalizeBarcode(item.barcode),
      tokens,
      strongTokens,
      concepts,
      dimensions: extractDimensions(text),
      volumes: extractUnitValues(text, ['ml', 'l', 'lt', 'cc']),
      colors,
      families,
      materials,
      pieces: extractCounts(text, ['parca', 'adet', 'piece', 'pieces', 'pcs', 'pc']),
      persons: extractCounts(text, ['kisilik', 'person', 'people']),
      rejectedScraperIds: rejectedScraperIds(item.raw),
    },
  };
}

function intersection(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const value of a) {
    if (b.has(value)) out.push(value);
  }
  return out;
}

function addSignal(signals: string[], label: string, values?: string[]) {
  if (values && values.length > 0) {
    signals.push(`${label}: ${values.slice(0, 4).join(', ')}`);
  } else {
    signals.push(label);
  }
}

function hasAny(set: Set<string>): boolean {
  return set.size > 0;
}

function hasExclusiveConceptConflict(a: Set<string>, b: Set<string>): boolean {
  return MUTUALLY_EXCLUSIVE_CONCEPT_GROUPS.some((group) => {
    const left = [...a].filter((value) => group.has(value));
    const right = [...b].filter((value) => group.has(value));
    return left.length > 0 && right.length > 0 && left.every((value) => !right.includes(value));
  });
}

function scoreLevel(score: number): MatchConfidenceLevel {
  if (score >= 75) return 'high';
  if (score >= 46) return 'medium';
  if (score >= 28) return 'low';
  return 'none';
}

export function isAutoAttachableScore(score: CatalogMatchScore, minLevel: 'high' | 'medium' = 'medium'): boolean {
  if (score.evidence.conflicting) return false;
  if (score.level !== 'high' && (minLevel === 'high' || score.level !== 'medium')) return false;

  const e = score.evidence;
  return (
    e.exactIdentity ||
    (score.score >= 98 && e.sharedDistinctiveName && e.sharedSpecificFamily && e.sharedDimension && e.sharedColor)
  );
}

export function scorePreparedMatch(
  target: PreparedMatchProduct,
  candidate: PreparedMatchProduct<MatchCandidate>,
): CatalogMatchScore {
  const t = target.profile;
  const c = candidate.profile;
  const signals: string[] = [];
  const shared: string[] = [];
  let points = 0;
  let hardConflict = false;
  let exactIdentity = false;
  let sharedCodeFamily = false;
  let sharedDimension = false;
  let sharedSpecificFamily = false;
  let sharedColor = false;
  let sharedNameMeaning = false;
  let sharedDistinctiveName = false;

  if (t.barcode && c.barcode && t.barcode === c.barcode) {
    points += 100;
    exactIdentity = true;
    addSignal(signals, 'exact barcode');
    shared.push(t.barcode);
  }

  if (t.code && c.code && t.code === c.code) {
    points += 92;
    exactIdentity = true;
    addSignal(signals, 'exact product code');
    shared.push(t.code);
  } else {
    const sharedCodeFamilies = intersection(t.codeFamilies, c.codeFamilies);
    if (sharedCodeFamilies.length > 0) {
      sharedCodeFamily = true;
      points += 34;
      addSignal(signals, 'same code family', sharedCodeFamilies);
      shared.push(...sharedCodeFamilies);
    }
  }

  const dims = intersection(t.dimensions, c.dimensions);
  if (dims.length > 0) {
    sharedDimension = true;
    points += Math.min(36, 24 + (dims.length - 1) * 6);
    addSignal(signals, 'same dimensions', dims);
    shared.push(...dims);
  } else if (hasAny(t.dimensions) && hasAny(c.dimensions)) {
    points -= 22;
    hardConflict = true;
    addSignal(signals, 'different dimensions');
  }

  const volumes = intersection(t.volumes, c.volumes);
  if (volumes.length > 0) {
    points += 18;
    addSignal(signals, 'same volume', volumes);
    shared.push(...volumes);
  } else if (hasAny(t.volumes) && hasAny(c.volumes)) {
    points -= 20;
    hardConflict = true;
    addSignal(signals, 'different volume');
  }

  const targetSpecificFamilies = new Set([...t.families].filter((x) => !GENERIC_FAMILIES.has(x)));
  const candidateSpecificFamilies = new Set([...c.families].filter((x) => !GENERIC_FAMILIES.has(x)));
  const specificFamilies = intersection(targetSpecificFamilies, candidateSpecificFamilies);
  const broadFamilies = intersection(t.families, c.families).filter((x) => GENERIC_FAMILIES.has(x));
  if (specificFamilies.length > 0) {
    sharedSpecificFamily = true;
    points += Math.min(40, 24 + specificFamilies.length * 5);
    addSignal(signals, 'same product family', specificFamilies);
    shared.push(...specificFamilies);
  } else {
    if (broadFamilies.length > 0) {
      points += Math.min(8, 4 + broadFamilies.length);
      addSignal(signals, 'same broad category', broadFamilies);
      shared.push(...broadFamilies);
    }
    if (hasAny(targetSpecificFamilies) && hasAny(candidateSpecificFamilies)) {
      points -= 22;
      hardConflict = true;
      addSignal(signals, 'different product type');
    }
  }

  const colors = intersection(t.colors, c.colors);
  if (colors.length > 0) {
    sharedColor = true;
    points += Math.min(22, 14 + colors.length * 4);
    addSignal(signals, 'same color', colors);
    shared.push(...colors);

    const targetColors = comparableColors(t.colors);
    const candidateColors = comparableColors(c.colors);
    const targetOnly = [...targetColors].filter((color) => !candidateColors.has(color));
    const candidateOnly = [...candidateColors].filter((color) => !targetColors.has(color));
    if (targetOnly.length > 0 && candidateOnly.length > 0) {
      points -= 18;
      hardConflict = true;
      addSignal(signals, 'different extra color');
    }
  } else if (hasAny(t.colors) && hasAny(c.colors)) {
    points -= 20;
    hardConflict = true;
    addSignal(signals, 'different color');
  }

  const materials = intersection(t.materials, c.materials);
  if (materials.length > 0) {
    points += Math.min(12, 6 + materials.length * 3);
    addSignal(signals, 'same material', materials);
    shared.push(...materials);
  }

  const concepts = intersection(t.concepts, c.concepts);
  if (hasExclusiveConceptConflict(t.concepts, c.concepts)) {
    points -= 22;
    hardConflict = true;
    addSignal(signals, 'different size/person attribute');
  }
  const strongConcepts = concepts.filter((x) => !GENERIC_CONCEPTS.has(x));
  const supportConcepts = concepts.filter((x) => GENERIC_CONCEPTS.has(x));
  if (strongConcepts.length > 0) {
    sharedNameMeaning = true;
    points += Math.min(28, 14 + strongConcepts.length * 6);
    addSignal(signals, 'shared name meaning', strongConcepts);
    shared.push(...strongConcepts);
  }
  if (supportConcepts.length > 0) {
    points += Math.min(10, 4 + supportConcepts.length * 2);
    addSignal(signals, 'same product attribute', supportConcepts);
    shared.push(...supportConcepts);
  }

  const pieces = intersection(t.pieces, c.pieces);
  if (pieces.length > 0) {
    points += 7;
    addSignal(signals, 'same piece count', pieces);
  } else if (hasAny(t.pieces) && hasAny(c.pieces)) {
    points -= 12;
    hardConflict = true;
    addSignal(signals, 'different piece count');
  }
  const persons = intersection(t.persons, c.persons);
  if (persons.length > 0) {
    points += 7;
    addSignal(signals, 'same person count', persons);
  } else if (hasAny(t.persons) && hasAny(c.persons)) {
    points -= 12;
    hardConflict = true;
    addSignal(signals, 'different person count');
  }

  const strong = intersection(t.strongTokens, c.strongTokens)
    .filter((x) => !COLOR_WORDS[x] && !FAMILY_WORDS[x] && !MATERIAL_WORDS[x] && !CONCEPT_WORDS[x] && !/^\d{1,4}x\d{1,4}/.test(x));
  if (strong.length > 0) {
    sharedNameMeaning = true;
    sharedDistinctiveName = true;
    points += Math.min(28, strong.length * 6);
    addSignal(signals, 'shared name words', strong);
    shared.push(...strong);
  }

  const tokenOverlap = intersection(t.tokens, c.tokens);
  if (tokenOverlap.length > 0) points += Math.min(10, tokenOverlap.length * 1.5);

  let score = Math.max(0, Math.min(100, Math.round(points)));
  const hasStrongPositive =
    signals.some((s) =>
      s.startsWith('exact ') ||
      s.startsWith('same code family') ||
      s.startsWith('same dimensions') ||
      s.startsWith('same product family') ||
      s.startsWith('shared name meaning') ||
      s.startsWith('shared name words'),
    );

  if (!hasStrongPositive && score >= 28) score = 27;
  const safeMediumEvidence =
    exactIdentity ||
    (sharedNameMeaning && sharedSpecificFamily && (sharedDimension || sharedColor || sharedCodeFamily)) ||
    (sharedDimension && sharedSpecificFamily && sharedColor && (sharedNameMeaning || sharedCodeFamily)) ||
    (sharedCodeFamily && sharedNameMeaning && (sharedSpecificFamily || sharedDimension));
  const safeHighEvidence =
    exactIdentity ||
    (sharedNameMeaning && sharedDimension && sharedSpecificFamily && (sharedColor || sharedCodeFamily)) ||
    (sharedCodeFamily && sharedDimension && sharedSpecificFamily && (sharedColor || sharedNameMeaning));
  if (score >= 46 && !safeMediumEvidence) score = 44;
  if (score >= 75 && !safeHighEvidence) score = 74;
  if (hardConflict && score >= 46 && !(t.barcode && c.barcode && t.barcode === c.barcode) && !(t.code && c.code && t.code === c.code)) {
    score = Math.min(score, 44);
  }

  const level = scoreLevel(score);
  const reason =
    signals.length > 0
      ? signals.slice(0, 4).join('; ')
      : 'No useful shared code, size, color, family, or name signal.';

  return {
    score,
    level,
    signals,
    shared: Array.from(new Set(shared)).slice(0, 8),
    reason,
    evidence: {
      exactIdentity,
      sharedCodeFamily,
      sharedDimension,
      sharedSpecificFamily,
      sharedColor,
      sharedNameMeaning,
      sharedDistinctiveName,
      conflicting: hardConflict,
    },
  };
}

export function bestCatalogMatch(
  target: PreparedMatchProduct,
  candidates: Array<PreparedMatchProduct<MatchCandidate>>,
): CatalogMatchSuggestion | null {
  const blocked = target.profile.rejectedScraperIds;
  const ranked = candidates
    .filter((c) => !blocked.has(c.item.id))
    .map((candidate) => ({ candidate, score: scorePreparedMatch(target, candidate) }))
    .filter((x) => x.score.level !== 'none')
    .sort((a, b) => b.score.score - a.score.score);

  const winner = ranked[0];
  if (!winner) return null;

  const runner = ranked[1];
  let score = winner.score.score;
  let level = winner.score.level;
  let reason = winner.score.reason;

  if (runner && level !== 'low' && runner.score.score >= score - 5 && score < 92) {
    const e = winner.score.evidence;
    const strongDetailMatch =
      e.exactIdentity ||
      (e.sharedDimension && e.sharedSpecificFamily && (e.sharedColor || e.sharedNameMeaning)) ||
      (e.sharedCodeFamily && e.sharedDimension && e.sharedSpecificFamily);
    if (!strongDetailMatch) {
      score = Math.min(score, 44);
      level = 'low';
      reason = `${reason}; close alternative also matched, so keep for review.`;
    } else {
      reason = `${reason}; close alternative exists, but key product details align.`;
    }
  }

  return {
    scraper_product_id: winner.candidate.item.id,
    source_name: winner.candidate.item.source_name ?? null,
    image: winner.candidate.item.image ?? null,
    image_count: winner.candidate.item.image_count ?? 0,
    confidence: score,
    score,
    level,
    signals: winner.score.signals,
    shared: winner.score.shared,
    reason,
    evidence: winner.score.evidence,
  };
}

export function summarizeCatalogMatches(
  targets: PreparedMatchProduct[],
  candidates: Array<PreparedMatchProduct<MatchCandidate>>,
  sampleSize = 8,
): MatchSummary {
  const summary: MatchSummary = {
    checked: targets.length,
    suggestionsGenerated: 0,
    highConfidence: 0,
    mediumConfidence: 0,
    lowConfidence: 0,
    noConfidence: 0,
    wouldAutoAttachProducts: 0,
    wouldAutoAttachImages: 0,
    wouldSendToReview: 0,
    samples: [],
  };
  const autoUsedScraperIds = new Set<string>();

  for (const target of targets) {
    const suggestion = bestCatalogMatch(target, candidates);
    if (!suggestion) {
      summary.noConfidence++;
      summary.wouldSendToReview++;
      continue;
    }

    summary.suggestionsGenerated++;
    if (suggestion.level === 'high') summary.highConfidence++;
    if (suggestion.level === 'medium') summary.mediumConfidence++;
    if (suggestion.level === 'low') summary.lowConfidence++;

    if (isAutoAttachableScore(suggestion, 'medium')) {
      if (!autoUsedScraperIds.has(suggestion.scraper_product_id)) {
        autoUsedScraperIds.add(suggestion.scraper_product_id);
        summary.wouldAutoAttachProducts++;
        summary.wouldAutoAttachImages += suggestion.image_count;
      } else {
        summary.wouldSendToReview++;
      }
    } else {
      summary.wouldSendToReview++;
    }

    if (summary.samples.length < sampleSize) {
      summary.samples.push({
        csvProductId: target.item.id,
        csvName: displayProductName(target.item),
        csvCode: target.item.product_code ?? null,
        scraperProductId: suggestion.scraper_product_id,
        scraperName: suggestion.source_name,
        confidence: suggestion.score,
        level: suggestion.level,
        images: suggestion.image_count,
        reason: suggestion.reason,
      });
    }
  }

  return summary;
}

// Backward-compatible helpers for the older lightweight matcher.
export function tokenize(text: string | null | undefined): string[] {
  return words(text ?? '');
}

export function scoreMatch(csvTokens: string[], scrapedTokens: string[]) {
  const csv = new Set(csvTokens);
  const scraped = new Set(scrapedTokens);
  const shared = intersection(csv, scraped);
  const union = new Set([...csvTokens, ...scrapedTokens]);
  const score = union.size > 0 ? shared.length / union.size : 0;
  return {
    score,
    shared,
    strong: shared.some((x) => x.length >= 4 || /^\d{1,4}x\d{1,4}$/.test(x)),
  };
}
