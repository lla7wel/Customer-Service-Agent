import { envAny } from '../env';

export interface ProductDisplayInput {
  id?: string | null;
  product_code?: string | null;
  libyan_display_name?: string | null;
  arabic_name?: string | null;
  english_name?: string | null;
  source_name?: string | null;
  category?: string | null;
  arabic_keywords?: string[] | null;
  product_images?: Array<{
    public_url?: string | null;
    storage_path?: string | null;
    is_primary?: boolean | null;
    position?: number | null;
  }> | null;
}

export interface ProductOptionDisplay extends ProductDisplayInput {
  name?: string | null;
  price?: number | null;
  active_price?: number | null;
  website_url?: string | null;
}

const ARABIC_RE = /[\u0600-\u06ff]/;

function clean(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s ? s : null;
}

function arabic(value: unknown): string | null {
  const s = clean(value);
  return s && ARABIC_RE.test(s) ? s : null;
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[şŞ]/g, 's')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/[^a-z0-9.%/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PHRASES: Array<[RegExp, string]> = [
  [/\bmixing bowl\b|\bkaristirma kabi\b|\bkaristirma kab[iı]\b/, 'وعاء خلط'],
  [/\bcoffee cup set\b|\bkahve fincan takimi\b/, 'طقم فناجين قهوة'],
  [/\btea cup set\b|\bcay fincan takimi\b/, 'طقم أكواب شاي'],
  [/\bduvet cover\b|\bnevresim\b/, 'غطاء لحاف'],
  [/\bpillow ?case\b|\byastik kilifi\b/, 'غطاء مخدة'],
  [/\bsoap dispenser\b/, 'موزع صابون'],
  [/\bstorage box\b/, 'صندوق تخزين'],
  [/\btable ?cloth\b|\bmasa ortusu\b/, 'مفرش طاولة'],
  [/\bplace ?mat\b|\bsupla\b/, 'مفرش سفرة'],
  [/\bbath ?robe\b|\bbornoz\b/, 'روب حمام'],
  [/\bhand towel\b|\bel havlusu\b/, 'منشفة يد'],
  [/\bbath towel\b|\bbanyo havlusu\b/, 'منشفة حمام'],
  [/\bfitted sheet\b|\bcarsaf\b/, 'شرشف'],
  [/\bbowl\b|\bkase\b|\bkabi\b|\bkab[ıi]\b/, 'وعاء'],
  [/\bplate\b|\btabak\b/, 'طبق'],
  [/\bcup\b|\bfincan\b|\bkupa\b|\bbardak\b/, 'كوب'],
  [/\bmug\b/, 'مج'],
  [/\bsaucer\b/, 'صحن فنجان'],
  [/\btray\b|\btepsi\b/, 'صينية'],
  [/\btowel\b|\bhavlu\b/, 'منشفة'],
  [/\bblanket\b|\bbattaniye\b/, 'بطانية'],
  [/\bquilt\b|\byorgan\b/, 'لحاف'],
  [/\bcurtain\b|\bperde\b/, 'ستارة'],
  [/\brug\b|\bcarpet\b|\bhali\b/, 'سجادة'],
  [/\bbasket\b|\bsepet\b/, 'سلة'],
  [/\bvase\b|\bvazo\b/, 'مزهرية'],
  [/\bcandle\b|\bmum\b/, 'شمعة'],
  [/\borganizer\b/, 'منظم'],
  [/\bjar\b|\bkavanoz\b/, 'مرطبان'],
  [/\bpot\b|\btencere\b/, 'قدر'],
  [/\bpan\b|\btava\b/, 'مقلاة'],
  [/\bknife\b|\bbicak\b/, 'سكين'],
  [/\bfork\b|\bcatal\b/, 'شوكة'],
  [/\bspoon\b|\bkasik\b/, 'ملعقة'],
  [/\bnapkin\b|\bpecete\b/, 'منديل'],
  [/\bset\b|\btakimi\b|\btakim\b/, 'طقم'],
];

const TOKEN_WORDS: Record<string, string> = {
  enamel: 'مينا',
  emaye: 'مينا',
  ceramic: 'سيراميك',
  seramik: 'سيراميك',
  porcelain: 'بورسلين',
  glass: 'زجاج',
  cam: 'زجاج',
  cotton: 'قطن',
  pamuk: 'قطن',
  bamboo: 'خيزران',
  wood: 'خشب',
  wooden: 'خشب',
  plastic: 'بلاستيك',
  metal: 'معدن',
  steel: 'ستيل',
  linen: 'كتان',
  velvet: 'مخمل',
  green: 'أخضر',
  yesil: 'أخضر',
  blue: 'أزرق',
  mavi: 'أزرق',
  red: 'أحمر',
  kirmizi: 'أحمر',
  pink: 'وردي',
  pembe: 'وردي',
  white: 'أبيض',
  beyaz: 'أبيض',
  black: 'أسود',
  siyah: 'أسود',
  beige: 'بيج',
  bej: 'بيج',
  brown: 'بني',
  kahverengi: 'بني',
  gray: 'رمادي',
  grey: 'رمادي',
  gri: 'رمادي',
  yellow: 'أصفر',
  sari: 'أصفر',
  purple: 'بنفسجي',
  mor: 'بنفسجي',
  navy: 'كحلي',
  cream: 'كريمي',
  krem: 'كريمي',
  gold: 'ذهبي',
  silver: 'فضي',
  orange: 'برتقالي',
  turuncu: 'برتقالي',
  transparent: 'شفاف',
};

function pushUnique(out: string[], value: string | null | undefined) {
  if (value && !out.includes(value)) out.push(value);
}

function sizeText(text: string): string | null {
  const parts: string[] = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(cm|mm|ml|lt|liter|litre|l|pcs|piece|pieces)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = m[1].replace(',', '.');
    const unit = m[2].toLowerCase();
    const arUnit =
      unit === 'cm' ? 'سم' :
      unit === 'mm' ? 'مم' :
      unit === 'ml' ? 'مل' :
      unit === 'lt' || unit === 'liter' || unit === 'litre' || unit === 'l' ? 'لتر' :
      'قطعة';
    pushUnique(parts, `${n} ${arUnit}`);
  }
  return parts.length ? parts.join(' ') : null;
}

export function arabicFallbackProductName(p: ProductDisplayInput): string {
  const source = [p.english_name, p.source_name, p.category].map(clean).filter(Boolean).join(' ');
  const folded = fold(source);
  const words: string[] = [];
  for (const [re, label] of PHRASES) {
    if (re.test(folded)) pushUnique(words, label);
  }
  for (const token of folded.split(' ')) {
    pushUnique(words, TOKEN_WORDS[token]);
  }
  if (p.arabic_keywords?.length) {
    for (const kw of p.arabic_keywords.slice(0, 3)) pushUnique(words, arabic(kw));
  }
  pushUnique(words, sizeText(source));
  if (words.length) return words.slice(0, 7).join(' ');
  const code = clean(p.product_code);
  return code ? `منتج من إنجلش هوم رقم ${code}` : 'منتج من إنجلش هوم';
}

/** Customer-facing product name. Never returns raw English/Turkish text. */
export function customerProductName(p: ProductDisplayInput): string {
  return arabic(p.libyan_display_name) || arabic(p.arabic_name) || arabicFallbackProductName(p);
}

export function originalProductName(p: ProductDisplayInput): string | null {
  return clean(p.english_name) || clean(p.source_name) || null;
}

function storagePublicUrl(path: string | null | undefined): string | null {
  const cleanPath = clean(path);
  const base = envAny('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
  if (!cleanPath || !base) return null;
  const bucket = envAny('SUPABASE_STORAGE_BUCKET') || 'eh-media';
  const encoded = cleanPath.split('/').map(encodeURIComponent).join('/');
  return `${base.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/${encoded}`;
}

export function primaryProductImageUrl(p: ProductDisplayInput): string | null {
  const imgs = [...(p.product_images ?? [])]
    .filter(Boolean)
    .sort((a, b) => {
      if (!!b.is_primary !== !!a.is_primary) return Number(!!b.is_primary) - Number(!!a.is_primary);
      return (a.position ?? 9999) - (b.position ?? 9999);
    });
  for (const img of imgs) {
    const url = clean(img.public_url) || storagePublicUrl(img.storage_path);
    if (url) return url;
  }
  return null;
}

export function formatCustomerPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(Number(price))) return 'السعر بنأكدولك عليه';
  return `${Number(price).toLocaleString('en-US', { maximumFractionDigits: 2 })} د.ل`;
}

export function productOptionLine(p: ProductOptionDisplay, index?: number): string {
  const prefix = index != null ? `${index}. ` : '';
  const name = p.name && ARABIC_RE.test(p.name) ? p.name : customerProductName(p);
  const price = formatCustomerPrice(p.price ?? p.active_price ?? null);
  const link = clean(p.website_url);
  return `${prefix}${name} — ${price}${link ? `\n${link}` : ''}`;
}

/**
 * ADMIN/SCRIPTS ONLY — never used by the Messenger auto-reply pipeline.
 * The live pipeline routes every customer reply through composeCustomerReply()
 * (Gemini at temperature 0.7). This function is kept for admin tooling and
 * upgrade-test assertions only.
 */
export function buildProductOptionsMessage(products: ProductOptionDisplay[]): string {
  const usable = products.slice(0, 5);
  if (!usable.length) return 'مش واضحة عندي الصورة، ممكن تبعتي اسم المنتج أو كوده أو صورة أوضح؟';
  return [
    'لقيتلك أقرب خيارات، تقصدي أي واحد فيهم؟',
    ...usable.map((p, i) => productOptionLine(p, i + 1)),
  ].join('\n');
}

/**
 * LAST-RESORT FALLBACK — returned only when Gemini itself is unavailable (503 /
 * transient error). Under normal operation compose-reply.ts never reaches this;
 * Gemini composes all customer-facing text. Not a template, just a safe holding
 * message so the messenger doesn't silently fail.
 */
export function productClarifyingQuestion(): string {
  return 'مش واضح عندي المنتج، ممكن تبعتي اسمه أو الكود أو صورة أوضح؟';
}
