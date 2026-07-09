import type { Metadata } from 'next';
import './globals.css';
import { getLocale } from '@/lib/i18n/server';
import { dir } from '@/lib/i18n/config';
import { getTheme } from '@/lib/theme-server';

export const metadata: Metadata = {
  title: 'EH-SYSTEM1 — English Home Libya',
  description: 'Retail operations command center for English Home Libya.',
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
