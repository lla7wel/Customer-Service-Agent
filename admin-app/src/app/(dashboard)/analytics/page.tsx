import { BarChart3 } from 'lucide-react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import AnalyticsWorkspace from '@/components/analytics/AnalyticsWorkspace';
import { getLocale } from '@/lib/i18n/server';
import { SESSION_COOKIE, requireAdmin } from '@/lib/auth';
import { canAccessSection } from '@/lib/rbac';
import { getDb } from '@/lib/db';
import { databaseStatus } from '@integrations/status';
import { getAnalytics } from '@integrations/pipelines/analytics-query';

export const dynamic = 'force-dynamic';

/** Analytics workspace — Owner and Analyzer only (guarded by the shell layout
 *  and re-checked here as defense in depth). */
export default async function AnalyticsPage() {
  const locale = await getLocale();
  const admin = await requireAdmin((await cookies()).get(SESSION_COOKIE)?.value);
  if (!admin) redirect('/login');
  if (!canAccessSection(admin.role, 'analytics')) redirect('/');

  const title = locale === 'ar' ? 'التحليلات' : 'Analytics';
  const subtitle = locale === 'ar'
    ? 'أرقام حقيقية بتوقيت طرابلس مع مقارنة بالفترة السابقة — لا أصفار وهمية.'
    : 'Truthful, Tripoli-time metrics with previous-period comparison — never fabricated zeroes.';

  if (!databaseStatus().configured) {
    return (
      <>
        <PageHeader title={title} subtitle={subtitle} icon={BarChart3} />
        <NotConnected status={databaseStatus()} />
      </>
    );
  }

  const db = getDb()!;
  const initial = await getAnalytics(db, { days: 7 });

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} icon={BarChart3} />
      <AnalyticsWorkspace initial={initial} locale={locale} />
    </>
  );
}
