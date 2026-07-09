import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { getLocale } from '@/lib/i18n/server';
import { getTheme } from '@/lib/theme-server';
import { allIntegrationStatuses } from '@integrations/status';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const theme = await getTheme();
  const statuses = allIntegrationStatuses();

  const userEmail = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);

  return (
    <div className="premium-shell flex h-dvh overflow-hidden">
      <Sidebar locale={locale} statuses={statuses} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <Topbar locale={locale} theme={theme} statuses={statuses} userEmail={userEmail} />
        <main className="scroll-thin safe-x relative flex-1 overflow-y-auto overflow-x-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-48 cc-grid opacity-60" />
          <div className="safe-b relative mx-auto max-w-[1400px] animate-fade-in p-4 sm:p-5 lg:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
