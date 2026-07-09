export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_COOKIE = 'eh_locale';

export function defaultLocale(): Locale {
  const env = process.env.NEXT_PUBLIC_DEFAULT_LOCALE;
  return env === 'en' ? 'en' : 'ar';
}

export function isRtl(locale: Locale): boolean {
  return locale === 'ar';
}

export function dir(locale: Locale): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

export function normalizeLocale(v: string | undefined | null): Locale {
  return v === 'en' ? 'en' : v === 'ar' ? 'ar' : defaultLocale();
}
