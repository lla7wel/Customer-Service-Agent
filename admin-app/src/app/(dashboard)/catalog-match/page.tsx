import { Images } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import CatalogMatch from '@/components/catalog/CatalogMatch';
import CatalogReviewTabs from '@/components/catalog/CatalogReviewTabs';
import { getT } from '@/lib/i18n/server';
import { databaseStatus } from '@integrations/status';

export const dynamic = 'force-dynamic';

export default async function CatalogMatchPage() {
  const { locale } = await getT();
  const ar = locale === 'ar';
  const status = databaseStatus();

  return (
    <div>
      <CatalogReviewTabs locale={locale} />
      <PageHeader
        icon={Images}
        title={ar ? 'مطابقة صور الكتالوج' : 'Catalog Image Match'}
        subtitle={ar ? 'اربط صور السكرابر بمنتجات الكتالوج التي بلا صور' : 'Attach scraper images to CSV catalog products that have none'}
      />
      {!status.configured ? <NotConnected status={status} /> : <CatalogMatch ar={ar} />}
    </div>
  );
}
