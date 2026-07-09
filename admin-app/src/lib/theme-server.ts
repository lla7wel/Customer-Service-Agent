import { cookies } from 'next/headers';
import { THEME_COOKIE, type Theme } from './theme';

/** Server-side: read the admin's theme (defaults to the dark command center). */
export function getTheme(): Theme {
  const v = cookies().get(THEME_COOKIE)?.value;
  return v === 'light' ? 'light' : 'dark';
}
