import type { Metadata } from 'next';
// Self-hosted IBM Plex Sans Arabic (SIL OFL 1.1) — bundled woff2, no runtime
// CDN. Regular / Medium / SemiBold / Bold for the Arabic-first UI. License:
// see src/fonts/IBM-Plex-OFL.txt (copied from the @fontsource package).
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import './globals.css';
import { getLocale } from '@/lib/i18n/server';
import { dir } from '@/lib/i18n/config';
import { getTheme } from '@/lib/theme-server';

export const metadata: Metadata = {
  title: 'English Home Libya — Operations Center',
  description: 'The online operations center for English Home Libya.',
  verification: {
    other: {
      'facebook-domain-verification': '70t4mpxdj37vynq0mpgjezniwyxtgf',
    },
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const theme = await getTheme();
  return (
    <html lang={locale} dir={dir(locale)} className={theme === 'dark' ? 'dark' : ''}>
      <body>{children}</body>
    </html>
  );
}
