import { cookies } from 'next/headers';
import { THEME_COOKIE, type Theme } from './theme';

/** Server-side: read the admin's theme (editorial light is the default). */
export async function getTheme(): Promise<Theme> {
  const v = (await cookies()).get(THEME_COOKIE)?.value;
  return v === 'dark' ? 'dark' : 'light';
}
