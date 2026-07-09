import { cookies } from 'next/headers';
import { THEME_COOKIE, type Theme } from './theme';

/** Server-side: read the admin's theme (defaults to the dark command center). */
export async function getTheme(): Promise<Theme> {
  const v = (await cookies()).get(THEME_COOKIE)?.value;
  return v === 'light' ? 'light' : 'dark';
}
