import { ImageIcon, Info } from 'lucide-react';
import { PageHeader, Card, EmptyState, Notice } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import { getT } from '@/lib/i18n/server';
import { supabaseStatus } from '@integrations/status';
import { fetchRows } from '@/lib/data';
import ImageReviewClient from '@/components/image-review/ImageReviewClient';
import CatalogReviewTabs from '@/components/catalog/CatalogReviewTabs';

export const dynamic = 'force-dynamic';

interface Correction {
  id: string;
  customer_image_url: string | null;
  outcome: string;
  ai_top_score: number | null;
  notes: string | null;
  created_at: string;
  ai_suggested_product_ids: string[] | null;
  corrected_product_id: string | null;
}

export default async function ImageReviewPage() {
  const { t, locale } = getT();
  const ar = locale === 'ar';
  const status = supabaseStatus();
  const { connected, rows, error } = await fetchRows<Correction>('image_match_corrections', (q) => q.order('created_at', { ascending: false }).limit(60));

  return (
    <div>
      <CatalogReviewTabs locale={locale} />
      <PageHeader icon={ImageIcon} title={t('nav_image_review')} subtitle={ar ? 'مراجعة مطابقة صور العملاء وحفظ التصحيحات' : 'Review customer image matches & save corrections'} />
      <div className="mb-4">
        <Notice icon={Info}>
          {ar ? 'المطابقة الصحيحة لا تحتاج موافقة. هذه الصفحة للحالات الغامضة وحفظ التصحيحات لتحسين المطابقة.' : 'Correct matches need no approval. This page is for ambiguous cases + saving corrections that improve future matching.'}
        </Notice>
      </div>

      {!connected ? (
        <NotConnected status={status} />
      ) : error ? (
        <Card><p className="text-sm text-danger">{error}</p></Card>
      ) : rows.length === 0 ? (
        <EmptyState icon={ImageIcon} title={ar ? 'لا توجد صور للمراجعة' : 'No images to review'} hint={ar ? 'عندما يرسل العميل صورة ولا تُطابق بثقة، تظهر هنا.' : 'When a customer image cannot be matched confidently, it appears here.'} />
      ) : (
        <ImageReviewClient rows={rows} locale={locale} />
      )}
    </div>
  );
}
