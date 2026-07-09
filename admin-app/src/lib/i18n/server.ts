import { cookies } from 'next/headers';
import { LOCALE_COOKIE, normalizeLocale, dir, type Locale } from './config';
import { translate } from './dictionaries';

/** Read the admin's chosen locale from the cookie (server components/routes). */
export async function getLocale(): Promise<Locale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  return normalizeLocale(c);
}

/** Server-side translation bundle for a request. */
export async function getT(): Promise<{
  locale: Locale;
  dir: 'rtl' | 'ltr';
  t: (key: string) => string;
}> {
  const locale = await getLocale();
  return {
    locale,
    dir: dir(locale),
    t: (key: string) => translate(locale, key),
  };
}
