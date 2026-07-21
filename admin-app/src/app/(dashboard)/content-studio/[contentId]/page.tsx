import { Clapperboard } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import ContentEditor from '@/components/content/ContentEditor';
import { getT } from '@/lib/i18n/server';
import { databaseStatus } from '@integrations/status';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function ContentItemPage(props: { params: Promise<{ contentId: string }> }) {
  const { contentId } = await props.params;
  const { locale } = await getT();
  const ar = locale === 'ar';
  const db = getDb();
  if (!db) {
    return (
      <div>
        <PageHeader icon={Clapperboard} title={ar ? 'استوديو المحتوى' : 'Content Studio'} />
        <NotConnected status={databaseStatus()} />
      </div>
    );
  }
  return <ContentEditor contentId={contentId} />;
}
