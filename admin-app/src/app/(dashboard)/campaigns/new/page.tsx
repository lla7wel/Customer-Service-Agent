import Link from 'next/link';
import { ArrowLeft, Megaphone } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { getT } from '@/lib/i18n/server';
import { databaseStatus } from '@integrations/status';
import NotConnected from '@/components/NotConnected';
import CampaignBuilder from '@/components/campaigns/CampaignBuilder';

export const dynamic = 'force-dynamic';

export default function NewCampaignPage() {
  const { locale } = getT();
  const ar = locale === 'ar';
  const status = databaseStatus();

  return (
    <div>
      <Link href="/campaigns" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg">
        <ArrowLeft size={15} className="rtl-flip" /> {ar ? 'رجوع للحملات' : 'Back to campaigns'}
      </Link>
      <PageHeader icon={Megaphone} title={ar ? 'حملة جديدة' : 'New campaign'} subtitle={ar ? 'الخطوة 1: الأساسيات' : 'Step 1: the basics'} />
      {!status.configured ? <NotConnected status={status} /> : <CampaignBuilder locale={locale} />}
    </div>
  );
}
