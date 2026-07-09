import Link from 'next/link';
import { Package, ImageOff, ChevronLeft, ChevronRight, Tag, Image, Search } from 'lucide-react';
import { PageHeader, Card, EmptyState, Badge } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import ProductsToolbar from '@/components/products/ProductsToolbar';
import AddProductButton from '@/components/products/AddProductButton';
import { getT } from '@/lib/i18n/server';
import { databaseStatus } from '@integrations/status';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { getDb } from '@/lib/db';
import { formatPrice, humanize, resolveProductName } from '@/lib/format';

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
  base_price: number | null;
  active_price: number | null;
  campaign_price: number | null;
  status: string;
  product_images?: { public_url: string | null; is_primary: boolean; position: number }[];
}

function primaryUrl(r: Row): string | null {
  const imgs = r.product_images ?? [];
  const p = imgs.find((i) => i.is_primary) ?? [...imgs].sort((a, b) => a.position - b.position)[0];
  return p?.public_url ?? null;
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: { q?: string; category?: string; page?: string; view?: string; status?: string; images?: string };
}) {
  const { t, locale } = getT();
  const ar = locale === 'ar';
  const status = databaseStatus();
  const view = searchParams.view === 'list' ? 'list' : 'grid';
  const page = Math.max(0, parseInt(searchParams.page ?? '0', 10) || 0);
  const q = (searchParams.q ?? '').trim();
  const category = searchParams.category ?? '';
  const statusF = searchParams.status ?? '';
  const imagesF = searchParams.images ?? '';

  const supabase = getDb();
  if (!supabase) {
    return (
      <div>
        <PageHeader icon={Package} title={t('nav_products')} subtitle={ar ? 'قاعدة بيانات المنتجات' : 'Product database'} />
        <NotConnected status={status} />
      </div>
    );
  }

  // Build query
  let query = supabase
    .selectFrom('products')
    .select(['id', 'product_code', 'barcode', 'source_name', 'english_name', 'arabic_name', 'libyan_display_name', 'category', 'base_price', 'active_price', 'campaign_price', 'status'])
    .select((eb) => [
      jsonArrayFrom(
        eb.selectFrom('product_images').select(['public_url', 'is_primary', 'position'])
          .whereRef('product_images.product_id', '=', 'products.id').orderBy('position', 'asc'),
      ).as('product_images'),
    ]);
  if (q) {
    const like = `%${q}%`;
    const cols = ['libyan_display_name', 'arabic_name', 'english_name', 'source_name', 'product_code', 'barcode'] as const;
    query = query.where((eb) => eb.or(cols.map((c) => eb(`products.${c}`, 'ilike', like))));
  }
  if (category) query = query.where('category', '=', category);
  if (statusF === 'active') query = query.where('products.status', '=', 'active');
  else if (statusF === 'review') query = query.where('products.status', '=', 'draft');
  if (imagesF === 'with') query = query.where('primary_image_id', 'is not', null);
  else if (imagesF === 'missing') query = query.where('primary_image_id', 'is', null);

  let rows: Row[] = [];
  let total = 0;
  let error: { message: string } | null = null;
  let categories: string[] = [];
  try {
    const [data, countRow, catRes] = await Promise.all([
      query.orderBy('updated_at', 'desc').limit(PAGE_SIZE).offset(page * PAGE_SIZE).execute(),
      query.clearSelect().select((eb) => eb.fn.countAll().as('n')).executeTakeFirst(),
      supabase.selectFrom('products').select('category').distinct().where('category', 'is not', null).execute(),
    ]);
    rows = data as unknown as Row[];
    total = Number(countRow?.n ?? 0);
    categories = catRes.map((r) => r.category).filter(Boolean).sort() as string[];
  } catch (e: any) {
    error = { message: e?.message ?? 'query_failed' };
  }
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <PageHeader
        icon={Package}
        title={t('nav_products')}
        subtitle={`${ar ? 'قاعدة المنتجات' : 'Product database'}${total ? ` · ${total.toLocaleString()}` : ''}`}
        actions={<AddProductButton locale={locale} />}
      />

      <section className="command-surface mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="relative flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
            <Package size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold text-fg">{ar ? 'مدير الكتالوج' : 'Catalog manager'}</p>
            <p className="text-xs text-muted">{ar ? 'ابحث، راجع الصور، وثبّت أسعار المنتجات النشطة.' : 'Search, inspect image coverage, and keep active pricing ready.'}</p>
          </div>
        </div>
        <div className="relative grid grid-cols-3 gap-2 text-xs sm:w-96">
          <CatalogChip icon={Search} label={ar ? 'النتائج' : 'Results'} value={total} />
          <CatalogChip icon={Image} label={ar ? 'بصور' : 'With images'} value={rows.filter((r) => primaryUrl(r)).length} />
          <CatalogChip icon={ImageOff} label={ar ? 'بدون صور' : 'Missing'} value={rows.filter((r) => !primaryUrl(r)).length} tone="warn" />
        </div>
      </section>

      <ProductsToolbar categories={categories} locale={locale} />

      {error ? (
        <Card><p className="text-sm text-danger">{error.message}</p></Card>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Package}
          title={q || category ? (ar ? 'لا نتائج' : 'No matches') : ar ? 'لا توجد منتجات بعد' : 'No products yet'}
          hint={q || category ? (ar ? 'جرّب بحثاً أو فئة مختلفة.' : 'Try a different search or category.') : ar ? 'استورد المنتجات: cd scripts && npm run import:products' : 'Import products: cd scripts && npm run import:products'}
        />
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {rows.map((r) => (
            <ProductCard key={r.id} r={r} ar={ar} />
          ))}
        </div>
      ) : (
        <Card pad={false} className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-faint">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{ar ? 'المنتج' : 'Product'}</th>
                <th className="px-4 py-2.5 text-start font-medium">{ar ? 'الفئة' : 'Category'}</th>
                <th className="px-4 py-2.5 text-start font-medium">{ar ? 'الكود' : 'Code'}</th>
                <th className="px-4 py-2.5 text-start font-medium">{ar ? 'السعر' : 'Price'}</th>
                <th className="px-4 py-2.5 text-start font-medium">{ar ? 'الحالة' : 'Status'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <ProductRow key={r.id} r={r} ar={ar} />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {totalPages > 1 && <Pager page={page} totalPages={totalPages} sp={searchParams} ar={ar} />}
    </div>
  );
}

function PriceBlock({ r }: { r: Row }) {
  const onSale = r.campaign_price != null && r.campaign_price !== r.base_price;
  return onSale ? (
    <span className="ltr-nums">
      <span className="font-semibold text-success">{formatPrice(r.active_price)}</span>{' '}
      <span className="text-xs text-faint line-through">{formatPrice(r.base_price)}</span>
    </span>
  ) : (
    <span className="ltr-nums font-medium text-fg">{formatPrice(r.active_price ?? r.base_price)}</span>
  );
}

function Thumb({ url, size = 'card' }: { url: string | null; size?: 'card' | 'row' }) {
  const cls = size === 'card' ? 'aspect-square w-full' : 'h-11 w-11 rounded-md';
  if (!url) {
    return (
      <div className={`flex items-center justify-center bg-surface2 text-faint ${size === 'card' ? 'aspect-square w-full' : 'h-11 w-11 rounded-md'}`}>
        <ImageOff size={size === 'card' ? 22 : 16} />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className={`${cls} object-cover`} loading="lazy" />;
}

/**
 * Catalog name (Arabic/English). If only the Turkish scraped name exists, show
 * it muted with a "TR source" tag so it's clearly reference-only / needs review.
 */
function ProductName({ r, ar, compact }: { r: Row; ar: boolean; compact?: boolean }) {
  const { name, kind } = resolveProductName(r);
  if (kind === 'catalog') {
    return <p className={`${compact ? '' : 'line-clamp-2 min-h-[2.5rem]'} text-sm font-medium text-fg`} dir="auto">{name}</p>;
  }
  return (
    <div className={compact ? '' : 'min-h-[2.5rem]'}>
      <p className="line-clamp-2 text-sm font-medium text-faint" dir="auto" title={name}>{name}</p>
      <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
        {ar ? 'اسم تركي — للمراجعة' : 'TR source — needs review'}
      </span>
    </div>
  );
}

function ProductCard({ r, ar }: { r: Row; ar: boolean }) {
  const imageCount = r.product_images?.length ?? 0;
  const hasImage = !!primaryUrl(r);
  return (
    <Link href={`/products/${r.id}`} className="card tilt-card group overflow-hidden p-0 transition hover:border-accent/40 hover:shadow-glow">
      <div className="relative overflow-hidden">
        <Thumb url={primaryUrl(r)} />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 to-transparent p-2 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
          <span className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-white">{r.product_code.slice(-8)}</span>
          <span className="rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">{imageCount} {ar ? 'صور' : 'img'}</span>
        </div>
        {r.campaign_price != null && r.campaign_price !== r.base_price && (
          <span className="absolute start-2 top-2 rounded-full bg-success px-2 py-0.5 text-[10px] font-bold text-black">{ar ? 'عرض' : 'SALE'}</span>
        )}
        {!hasImage && (
          <span className="absolute end-2 top-2 rounded-full bg-warning px-2 py-0.5 text-[10px] font-bold text-black">{ar ? 'صورة' : 'IMAGE'}</span>
        )}
      </div>
      <div className="p-3">
        <ProductName r={r} ar={ar} />
        {r.category && <p className="mt-0.5 flex items-center gap-1 text-xs text-faint"><Tag size={11} />{r.category}</p>}
        <div className="mt-3 flex items-center justify-between gap-2">
          <PriceBlock r={r} />
          <Badge tone={r.status === 'active' ? 'good' : r.status === 'out_of_stock' ? 'bad' : 'neutral'}>{humanize(r.status)}</Badge>
        </div>
      </div>
    </Link>
  );
}

function CatalogChip({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof Package;
  label: string;
  value: number;
  tone?: 'default' | 'warn';
}) {
  return (
    <div className="rounded-lg border border-line bg-surface/80 px-2.5 py-2">
      <p className="flex items-center gap-1 truncate text-[10px] text-faint"><Icon size={11} /> {label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${tone === 'warn' ? 'text-warning' : 'text-fg'}`}>{value.toLocaleString()}</p>
    </div>
  );
}

function ProductRow({ r, ar }: { r: Row; ar: boolean }) {
  return (
    <tr className="border-b border-line/60 transition last:border-0 hover:bg-surface2/50">
      <td className="px-4 py-2.5">
        <Link href={`/products/${r.id}`} className="flex items-center gap-3">
          <Thumb url={primaryUrl(r)} size="row" />
          <span className="min-w-0"><ProductName r={r} ar={ar} compact /></span>
        </Link>
      </td>
      <td className="px-4 py-2.5 text-muted">{r.category || '—'}</td>
      <td className="px-4 py-2.5 font-mono text-xs text-faint">{r.product_code}</td>
      <td className="px-4 py-2.5"><PriceBlock r={r} /></td>
      <td className="px-4 py-2.5"><Badge tone={r.status === 'active' ? 'good' : r.status === 'out_of_stock' ? 'bad' : 'neutral'}>{humanize(r.status)}</Badge></td>
    </tr>
  );
}

function Pager({ page, totalPages, sp, ar }: { page: number; totalPages: number; sp: Record<string, string | undefined>; ar: boolean }) {
  const mk = (p: number) => {
    const u = new URLSearchParams();
    if (sp.q) u.set('q', sp.q);
    if (sp.category) u.set('category', sp.category);
    if (sp.view) u.set('view', sp.view);
    if (sp.status) u.set('status', sp.status);
    if (sp.images) u.set('images', sp.images);
    u.set('page', String(p));
    return `/products?${u.toString()}`;
  };
  return (
    <div className="mt-5 flex items-center justify-center gap-2">
      <Link href={mk(Math.max(0, page - 1))} className={`btn-ghost ${page === 0 ? 'pointer-events-none opacity-40' : ''}`}>
        <ChevronLeft size={16} className="rtl-flip" /> {ar ? 'السابق' : 'Prev'}
      </Link>
      <span className="text-sm text-muted">{page + 1} / {totalPages}</span>
      <Link href={mk(Math.min(totalPages - 1, page + 1))} className={`btn-ghost ${page >= totalPages - 1 ? 'pointer-events-none opacity-40' : ''}`}>
        {ar ? 'التالي' : 'Next'} <ChevronRight size={16} className="rtl-flip" />
      </Link>
    </div>
  );
}
