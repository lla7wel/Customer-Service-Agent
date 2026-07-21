import Link from 'next/link';
import { ArrowLeft, Barcode, Hash, Tag, Globe, Package, Languages } from 'lucide-react';
import { Card, EmptyState, Badge } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import { getT } from '@/lib/i18n/server';
import { databaseStatus } from '@integrations/status';
import { fetchOne, fetchRows } from '@/lib/data';
import { formatPrice, humanize, resolveProductName } from '@/lib/format';
import type { Product, ProductImage } from '@integrations/db/rows';
import ProductGallery from '@/components/products/ProductGallery';
import ProductEditor from '@/components/products/ProductEditor';
import PriceHistoryPanel from '@/components/products/PriceHistoryPanel';
import FamilyPanel from '@/components/products/FamilyPanel';

export const dynamic = 'force-dynamic';

export default async function ProductDetailPage(props: { params: Promise<{ productId: string }> }) {
  const params = await props.params;
  const { locale } = await getT();
  const ar = locale === 'ar';
  const status = databaseStatus();

  if (!status.configured) {
    return (
      <div>
        <Back ar={ar} />
        <NotConnected status={status} />
      </div>
    );
  }

  const [{ row: product }, images] = await Promise.all([
    fetchOne<Product>('products', params.productId),
    fetchRows<ProductImage>('product_images', (q) => q.where('product_id', '=', params.productId).orderBy('position', 'asc')),
  ]);

  if (!product) {
    return (
      <div>
        <Back ar={ar} />
        <EmptyState icon={Package} title={ar ? 'المنتج غير موجود' : 'Product not found'} />
      </div>
    );
  }

  const resolved = resolveProductName(product);
  const name = resolved.name;
  const onSale = product.campaign_price != null && product.campaign_price !== product.base_price;

  return (
    <div>
      <Back ar={ar} />
      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        {/* Left: gallery + quick facts */}
        <div className="space-y-4">
          <ProductGallery images={images.rows} locale={locale} />

          <Card>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">{ar ? 'المعلومات' : 'Details'}</h3>
            <dl className="space-y-2.5 text-sm">
              <Fact icon={Hash} label={ar ? 'كود المنتج' : 'Product code'} value={product.product_code} mono />
              <Fact icon={Barcode} label={ar ? 'الباركود' : 'Barcode'} value={product.barcode || '—'} mono />
              <Fact icon={Tag} label={ar ? 'الفئة' : 'Category'} value={product.category || '—'} />
              {product.source_name && (
                <Fact icon={Languages} label={ar ? 'الاسم المصدر (تركي، مرجعي)' : 'Source name (Turkish, reference)'} value={product.source_name} />
              )}
              <div className="flex items-center justify-between border-t border-line pt-2.5">
                <dt className="flex items-center gap-2 text-muted"><Tag size={14} className="text-accent" />{ar ? 'السعر الفعّال' : 'Active price'}</dt>
                <dd className="ltr-nums text-base font-semibold text-success">{formatPrice(product.active_price ?? product.base_price)}</dd>
              </div>
              {onSale && (
                <div className="flex items-center justify-between text-xs">
                  <dt className="text-faint">{ar ? 'قبل الخصم' : 'Before discount'}</dt>
                  <dd className="ltr-nums text-faint line-through">{formatPrice(product.base_price)}</dd>
                </div>
              )}
              {product.website_url && (
                <a href={product.website_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 border-t border-line pt-2.5 text-xs text-accent hover:underline">
                  <Globe size={13} /> {ar ? 'رابط المصدر (مرجعي فقط)' : 'Source URL (reference only)'}
                </a>
              )}
            </dl>
          </Card>
        </div>

        {/* Right: header + editor */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className={`text-2xl font-semibold tracking-tight ${resolved.kind === 'catalog' ? 'text-fg' : 'text-faint'}`} dir="auto">{name}</h1>
              <p className="mt-1 font-mono text-xs text-faint">{product.product_code}</p>
            </div>
            <div className="flex items-center gap-2">
              {resolved.kind !== 'catalog' && <Badge tone="warn">{ar ? 'بحاجة لاسم عربي/إنجليزي' : 'Needs Arabic/English name'}</Badge>}
              <Badge tone={product.status === 'active' ? 'good' : product.status === 'out_of_stock' ? 'bad' : 'neutral'}>{humanize(product.status)}</Badge>
              {onSale && <Badge tone="accent">{ar ? 'سعر حملة فعّال' : 'Campaign price'}</Badge>}
            </div>
          </div>

          <ProductEditor product={product} locale={locale} />

          <div className="grid gap-4 xl:grid-cols-2">
            <PriceHistoryPanel productId={product.id} ar={ar} />
            <FamilyPanel productId={product.id} ar={ar} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ icon: Icon, label, value, mono }: { icon: any; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-muted"><Icon size={14} className="text-faint" />{label}</dt>
      <dd className={`text-end text-fg ${mono ? 'font-mono text-xs' : ''}`} dir="auto">{value}</dd>
    </div>
  );
}

function Back({ ar }: { ar: boolean }) {
  return (
    <Link href="/catalog" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg">
      <ArrowLeft size={15} className="rtl-flip" /> {ar ? 'رجوع للمنتجات' : 'Back to products'}
    </Link>
  );
}
