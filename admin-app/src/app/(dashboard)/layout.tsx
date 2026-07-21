import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import MobileNav from '@/components/MobileNav';
import { getLocale } from '@/lib/i18n/server';
import { getTheme } from '@/lib/theme-server';
import { allIntegrationStatuses } from '@integrations/status';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const theme = await getTheme();
  const statuses = allIntegrationStatuses();

  const admin = await requireAdmin((await cookies()).get(SESSION_COOKIE)?.value);
  const userEmail = admin ? (admin.displayName || admin.username) : null;

  return (
    <div className="premium-shell flex h-dvh overflow-hidden">
      <Sidebar locale={locale} statuses={statuses} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <Topbar locale={locale} theme={theme} statuses={statuses} userEmail={userEmail} />
        <main className="scroll-thin safe-x relative flex-1 overflow-y-auto overflow-x-hidden">
          <div className="safe-b relative mx-auto max-w-[1480px] animate-fade-in p-3 pb-24 sm:p-5 sm:pb-24 md:pb-6 lg:p-7">{children}</div>
        </main>
        <MobileNav locale={locale} theme={theme} userEmail={userEmail} statuses={statuses} />
      </div>
    </div>
  );
}
