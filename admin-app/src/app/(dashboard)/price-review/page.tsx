import Link from 'next/link';
import { Tags, ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react';
import { PageHeader, Card, EmptyState } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import Diagnostics from '@/components/catalog/Diagnostics';
import CatalogReviewTabs from '@/components/catalog/CatalogReviewTabs';
import PriceReviewCard, { type ReviewItem } from '@/components/products/PriceReviewCard';
import { getT } from '@/lib/i18n/server';
import { databaseStatus } from '@integrations/status';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { getDb } from '@/lib/supabase/db';
import { getCatalogStats } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 48;

interface Row {
  id: string;
  product_code: string;
  barcode: string | null;
  source_name: string | null;
  english_name: string | null;
  arabic_name: string | null;
  libyan_display_name: string | null;
  category: string | null;
  website_url: string | null;
  product_images?: { public_url: string | null; is_primary: boolean; position: number }[];
}

function toItem(r: Row): ReviewItem {
  const imgs = r.product_images ?? [];
  const primary = imgs.find((i) => i.is_primary) ?? [...imgs].sort((a, b) => a.position - b.position)[0];
  return {
    id: r.id,
    product_code: r.product_code,
    barcode: r.barcode,
    catalogName: r.libyan_display_name || r.arabic_name || r.english_name || null,
    english_name: r.english_name,
    arabic_name: r.arabic_name,
    category: r.category,
    source_name: r.source_name, // Turkish — reference for translation
    website_url: r.website_url,
    image: primary?.public_url ?? null,
  };
}

export default async function PriceReviewPage({ searchParams }: { searchParams: { page?: string } }) {
  const { locale } = getT();
  const ar = locale === 'ar';
  const status = databaseStatus();
  const page = Math.max(0, parseInt(searchParams.page ?? '0', 10) || 0);

  const supabase = getDb();
  if (!supabase) {
    return (
      <div>
        <PageHeader icon={Tags} title={ar ? 'مراجعة الأسعار' : 'Price Review'} subtitle={ar ? 'منتجات بحاجة لسعر قبل تفعيلها' : 'Products needing a price before they go live'} />
        <NotConnected status={status} />
      </div>
    );
  }

  const baseQuery = supabase
    .selectFrom('products')
    .select(['id', 'product_code', 'barcode', 'source_name', 'english_name', 'arabic_name', 'libyan_display_name', 'category', 'website_url'])
    .select((eb) => [
      jsonArrayFrom(
        eb.selectFrom('product_images').select(['public_url', 'is_primary', 'position'])
          .whereRef('product_images.product_id', '=', 'products.id').orderBy('position', 'asc'),
      ).as('product_images'),
    ])
    .where('base_price', 'is', null);
  const [stats, data, countRow] = await Promise.all([
    getCatalogStats(),
    baseQuery.orderBy('updated_at', 'desc').limit(PAGE_SIZE).offset(page * PAGE_SIZE).execute(),
    baseQuery.clearSelect().select((eb) => eb.fn.countAll().as('n')).executeTakeFirst(),
  ]);

  const rows = data as unknown as Row[];
  const total = Number(countRow?.n ?? 0);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <CatalogReviewTabs locale={locale} />
      <PageHeader
        icon={Tags}
        title={ar ? 'مراجعة المنتجات' : 'Product Review'}
        subtitle={`${ar ? 'أضف الاسم العربي/الإنجليزي والسعر لتفعيل المنتج' : 'Add an Arabic/English name + price to activate the product'}${total ? ` · ${total.toLocaleString()}` : ''}`}
      />

      <div className="mb-5"><Diagnostics stats={stats} ar={ar} /></div>

      {rows.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={ar ? 'لا توجد منتجات بحاجة لتسعير' : 'No products need pricing'}
          hint={ar ? 'كل المنتجات مسعّرة وفعّالة.' : 'Every product is priced and active.'}
          action={<Link href="/products" className="btn-ghost">{ar ? 'المنتجات' : 'Products'}</Link>}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {rows.map((r) => (
              <PriceReviewCard key={r.id} item={toItem(r)} ar={ar} />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="mt-5 flex items-center justify-center gap-2">
              <Link href={`/price-review?page=${Math.max(0, page - 1)}`} className={`btn-ghost ${page === 0 ? 'pointer-events-none opacity-40' : ''}`}>
                <ChevronLeft size={16} className="rtl-flip" /> {ar ? 'السابق' : 'Prev'}
              </Link>
              <span className="text-sm text-muted">{page + 1} / {totalPages}</span>
              <Link href={`/price-review?page=${Math.min(totalPages - 1, page + 1)}`} className={`btn-ghost ${page >= totalPages - 1 ? 'pointer-events-none opacity-40' : ''}`}>
                {ar ? 'التالي' : 'Next'} <ChevronRight size={16} className="rtl-flip" />
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
