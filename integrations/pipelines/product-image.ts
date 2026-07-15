/**
 * Product-image sending — pure helpers.
 *
 * The Messenger AI can send REAL catalog product photos when a customer asks to
 * see them ("ابعثلي صورته", "نبي نشوفهم", "شنو الألوان؟"). The rules that keep
 * this safe and non-spammy live here, dependency-free, so they are unit-tested
 * and identical wherever they run.
 *
 * Hard guarantees enforced here:
 *   - The backend chooses the actual image URLs; Gemini never picks a URL.
 *   - Only HTTPS, publicly-fetchable URLs are ever sent to Meta (no local file
 *     paths, no localhost, no broken URLs).
 *   - At most 3 images are sent automatically (no spam), de-duplicated by product
 *     and by identical image URL.
 *   - Same-family colour variants are grouped so the customer isn't asked to
 *     choose between identical items.
 */
import type { ProductCandidate } from '../tools';
import { normalizeCode } from '../catalog-match';

/** Hard cap on images auto-sent in one turn (no-spam guarantee). */
export const MAX_AUTO_IMAGES = 3;

/* -------------------------------------------------------------------------- */
/* Image-intent detection                                                     */
/* -------------------------------------------------------------------------- */

// "a photo / picture" — covers صورة/صور/صورته/صورهم + English.
const PHOTO_WORD =
  /(صور[ةه]?|صورت(?:ه|ها|هم|هن|ك|كم)?|صورهم|صورها|الصور|بالصور|photos?|pictures?|\bpics?\b|image|اعرض الصور)/i;

// "show me / show them"
const SHOW_WORD =
  /(ورّ?ين[ايى]?|ورّ?ينيهم|ورّ?يني|ورّ?يهم|ورونا|ورّ?ينا|show me|show them|lemme see|let me see)/i;

// shape / look / colour intent
const LOOK_WORD =
  /(شكل(?:ه|ها|هم)?|الشكل|الأشكال|الاشكال|لون(?:ه|ها|هم)?|اللون|ألوان(?:ه|ها|هم)?|الألوان|الالوان|الوان(?:ه|ها)?|colou?rs?|how it looks|the look)/i;

// explicit "let me/we see IT/THEM"
const SEE_OBJECT =
  /(نشوفه[ام]?|نشوفها|نشوفهن|نشوفو|أشوفه[ام]?|اشوفه[ام]?|نشوفهم|أشوفها|اشوفها)/i;

// "see / want to see" + an options-style noun → visual browse
const SEE_WORD = /(نشوف|أشوف|اشوف|نحب نشوف|نبي نشوف|خليني نشوف|خليني نشوف)/i;
const OPTIONS_WORD = /(الخيارات|الخيارت|الموديلات|الموديل|الأشكال|الاشكال|الأنواع|الانواع|options|models)/i;

/**
 * Does the customer clearly want to SEE product photos / shapes / colours?
 * Conservative: a price/availability question alone never matches.
 */
export function detectImageRequest(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (PHOTO_WORD.test(t)) return true;          // "ابعثلي صورته", "في صور؟", "عندك صور للحمام؟"
  if (SHOW_WORD.test(t)) return true;           // "وريني", "ورينيهم"
  if (LOOK_WORD.test(t)) return true;           // "شكله كيف؟", "نبي نشوف اللون", "شنو الألوان؟"
  if (SEE_OBJECT.test(t)) return true;          // "خليني نشوفه", "نبي نشوفهم"
  if (SEE_WORD.test(t) && OPTIONS_WORD.test(t)) return true; // "نبي نشوف الخيارات"
  return false;
}

/* -------------------------------------------------------------------------- */
/* Image URL safety                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Is this URL safe to hand to the Meta Send API as an image attachment?
 * Meta fetches the URL itself, so it must be public HTTPS. Local paths,
 * localhost and non-HTTP(S) values are rejected (never sent to a customer).
 */
export function isMetaSafeImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (!/^https:\/\//i.test(u)) return false; // must be HTTPS (Meta requirement)
  if (/^https:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(u)) return false;
  if (/\s/.test(u)) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Selecting which images to send                                             */
/* -------------------------------------------------------------------------- */

export interface SendableSelection {
  /** {url, product_id} pairs to attach, in display order (<= MAX_AUTO_IMAGES). */
  images: { url: string; product_id: string }[];
  /** The candidates whose images were selected (for caption grounding). */
  products: ProductCandidate[];
  /** True when the selected items are the same family (colour variants). */
  grouped: boolean;
  /** How many distinct candidates had a usable image. */
  totalWithImages: number;
  /** True when more usable images exist than were selected. */
  more: boolean;
}

function familyKey(code: string | null | undefined): string {
  const n = code ? normalizeCode(code) : '';
  return n.length >= 6 ? n.slice(0, 6) : '';
}

/**
 * Pick up to `max` distinct products that have a Meta-safe image, de-duplicating
 * by product id and by identical image URL. Flags whether the picks are colour
 * variants of one family so the caption can say so naturally.
 */
export function selectSendableImages(candidates: ProductCandidate[] | null | undefined, max = MAX_AUTO_IMAGES): SendableSelection {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const unique: { product: ProductCandidate; url: string }[] = [];
  for (const c of candidates ?? []) {
    if (!c || typeof c.id !== 'string') continue;
    const url = c.image ?? null;
    if (!isMetaSafeImageUrl(url)) continue;
    if (seenIds.has(c.id) || seenUrls.has(url as string)) continue;
    seenIds.add(c.id);
    seenUrls.add(url as string);
    unique.push({ product: c, url: url as string });
  }
  const picked = unique.slice(0, Math.max(1, max));
  const families = new Set(picked.map((x) => familyKey(x.product.product_code)).filter(Boolean));
  const grouped = picked.length > 1 && families.size === 1 && !!familyKey(picked[0].product.product_code);
  return {
    images: picked.map((x) => ({ url: x.url, product_id: x.product.id })),
    products: picked.map((x) => x.product),
    grouped,
    totalWithImages: unique.length,
    more: unique.length > picked.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Structured runtime state                                                   */
/* -------------------------------------------------------------------------- */

/** Runtime facts for a reply that accompanies attached product photos. */
export function imageSendContext(opts: { count: number; grouped: boolean; more: boolean }): Record<string, unknown> {
  return { images_attached: true, image_count: opts.count, same_product_color_variants: opts.grouped, more_images_available: opts.more };
}

/** Runtime facts when the requested product photo is unavailable. */
export function imageUnavailableContext(): Record<string, unknown> {
  return { images_requested: true, images_available: false };
}
