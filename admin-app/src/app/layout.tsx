import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { getLocale } from '@/lib/i18n/server';
import { dir } from '@/lib/i18n/config';
import { getTheme } from '@/lib/theme-server';

export const metadata: Metadata = {
  title: 'English Home Libya — Operations Center',
  description: 'The online operations center for English Home Libya.',
};

const tajawal = localFont({
  src: [
    { path: '../../../integrations/content/fonts/Tajawal-Regular.ttf', weight: '400' },
    { path: '../../../integrations/content/fonts/Tajawal-Bold.ttf', weight: '700' },
  ],
  variable: '--font-ui',
  display: 'swap',
});

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const theme = await getTheme();
  return (
    <html lang={locale} dir={dir(locale)} className={theme === 'dark' ? 'dark' : ''}>
      <body className={tajawal.variable}>{children}</body>
    </html>
  );
}
