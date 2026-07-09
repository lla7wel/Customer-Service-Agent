import type { Locale } from './i18n/config';

export function formatPrice(value: number | null | undefined, currency = 'LYD'): string {
  if (value == null) return '—';
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`;
}

export function formatDate(value: string | null | undefined, locale: Locale = 'en'): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(locale === 'ar' ? 'ar-LY' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** "time since last reply" style relative label. */
export function timeAgo(value: string | null | undefined, locale: Locale = 'en'): string {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (isNaN(then)) return '—';
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  const ar = locale === 'ar';
  if (mins < 1) return ar ? 'الآن' : 'just now';
  if (mins < 60) return ar ? `قبل ${mins} د` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return ar ? `قبل ${hrs} س` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return ar ? `قبل ${days} ي` : `${days}d ago`;
}

/** Human label for a snake_case enum value. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ----------------------------------------------------------- product naming */

/**
 * Fields any product-name helper needs. `source_name` is the Turkish scraped
 * name — REFERENCE ONLY, never the customer/admin-facing catalog language.
 */
export interface NamedProduct {
  libyan_display_name?: string | null;
  arabic_name?: string | null;
  english_name?: string | null;
  source_name?: string | null;
  product_code?: string | null;
}

export type NameKind = 'catalog' | 'source' | 'code';

/**
 * Resolve a product's display name with explicit provenance so the UI can mark
 * Turkish source text as reference-only.
 *   - 'catalog' → Arabic/English (customer/admin-facing): libyan → arabic → english
 *   - 'source'  → only a Turkish scraped name exists (needs review, not customer-facing)
 *   - 'code'    → nothing but the product code
 */
export function resolveProductName(p: NamedProduct): { name: string; kind: NameKind } {
  const catalog = p.libyan_display_name || p.arabic_name || p.english_name;
  if (catalog) return { name: catalog, kind: 'catalog' };
  if (p.source_name) return { name: p.source_name, kind: 'source' };
  return { name: p.product_code || '—', kind: 'code' };
}

/** Customer/admin-facing name, or null if only Turkish/source data exists. */
export function catalogName(p: NamedProduct): string | null {
  return p.libyan_display_name || p.arabic_name || p.english_name || null;
}

/** True when a product has reviewed Arabic/English catalog naming. */
export function hasCatalogName(p: NamedProduct): boolean {
  return !!catalogName(p);
}

const ACTION_LABELS: Record<string, { en: string; ar: string }> = {
  ai_paused: { en: 'AI paused', ar: 'توقف الذكاء' },
  ai_resumed: { en: 'AI resumed', ar: 'استئناف الذكاء' },
  human_message: { en: 'Human reply', ar: 'رد موظف' },
  image_match_corrected: { en: 'Image match corrected', ar: 'تصحيح مطابقة صورة' },
  campaign_image_edit_generated: { en: 'Campaign image generated', ar: 'توليد صورة حملة' },
  campaign_image_edit_failed: { en: 'Campaign image failed', ar: 'فشل توليد صورة' },
  campaign_generated: { en: 'Campaign update', ar: 'تحديث حملة' },
  conversation_resolved: { en: 'Conversation resolved', ar: 'تم حل المحادثة' },
  order_draft_created: { en: 'Order draft created', ar: 'مسودة طلب' },
  order_draft_ai_filled: { en: 'Order draft filled', ar: 'تعبئة مسودة طلب' },
  order_confirmed: { en: 'Order confirmed', ar: 'تأكيد طلب' },
  fb_post: { en: 'Facebook post', ar: 'منشور فيسبوك' },
};

export function activityLabel(action: string | null | undefined, locale: Locale = 'en'): string {
  if (!action) return '—';
  const label = ACTION_LABELS[action];
  if (label) return locale === 'ar' ? label.ar : label.en;
  return humanize(action);
}

export function activitySummary(summary: string | null | undefined): string | null {
  const s = summary?.trim();
  if (!s) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return null;
  return s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '').replace(/\s{2,}/g, ' ').trim() || null;
}
