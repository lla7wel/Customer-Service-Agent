import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import MobileNav from '@/components/MobileNav';
import { getLocale } from '@/lib/i18n/server';
import { getTheme } from '@/lib/theme-server';
import { allIntegrationStatuses } from '@integrations/status';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, requireAdmin } from '@/lib/auth';
import { canAccessPath, landingPath } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const theme = await getTheme();
  const statuses = allIntegrationStatuses();
  const { getDb } = await import('@/lib/db');
  const brandLogo = await getDb()?.selectFrom('brand_kit').select('logo_public_url').where('id', '=', 1).executeTakeFirst().then((r) => r?.logo_public_url ?? null).catch(() => null);

  const admin = await requireAdmin((await cookies()).get(SESSION_COOKIE)?.value);
  // Defense in depth: the middleware already gated this, but never render the
  // shell for an unauthenticated request.
  if (!admin) redirect('/login');

  // Authoritative (live DB role) section guard. The path arrives via a header
  // the middleware sets, because a layout is not handed the current pathname.
  const pathname = (await headers()).get('x-eh-pathname') || '';
  if (pathname && !canAccessPath(admin.role, pathname)) {
    redirect(landingPath(admin.role));
  }

  const userEmail = admin.displayName || admin.username;

  return (
    <div className="premium-shell flex h-dvh overflow-hidden">
      <Sidebar locale={locale} statuses={statuses} role={admin.role} brandLogo={brandLogo} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <Topbar locale={locale} theme={theme} statuses={statuses} userEmail={userEmail} />
        <main className="scroll-thin safe-x relative flex-1 overflow-y-auto overflow-x-hidden">
          <div className="safe-b relative mx-auto max-w-[1480px] animate-fade-in p-3 pb-24 sm:p-5 sm:pb-24 md:pb-6 lg:p-7">{children}</div>
        </main>
        <MobileNav locale={locale} theme={theme} userEmail={userEmail} statuses={statuses} role={admin.role} />
      </div>
    </div>
  );
}
