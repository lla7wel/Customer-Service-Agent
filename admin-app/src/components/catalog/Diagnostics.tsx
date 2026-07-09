import { Package, FileSpreadsheet, CheckCircle2, ImageIcon, ImageOff, Tags, Images, CloudUpload, CloudOff } from 'lucide-react';
import type { CatalogStats } from '@/lib/catalog';

const fmt = (n: number) => n.toLocaleString();

/**
 * Catalog diagnostics strip. Shared by the dashboard, Price Review and Catalog
 * Sync pages. Surfaces the real catalog state: CSV catalog size, active/priced,
 * image coverage, and the scraped-only review backlog.
 */
export default function Diagnostics({ stats, ar }: { stats: CatalogStats; ar: boolean }) {
  const tiles: { icon: any; label: string; value: number; tone: string }[] = [
    { icon: Package, label: ar ? 'إجمالي المنتجات' : 'Total products', value: stats.products, tone: 'text-fg' },
    { icon: FileSpreadsheet, label: ar ? 'من الكتالوج CSV' : 'From CSV catalog', value: stats.csvProducts, tone: 'text-fg' },
    { icon: CheckCircle2, label: ar ? 'فعّالة/مسعّرة' : 'Active / priced', value: stats.activeProducts, tone: 'text-success' },
    { icon: ImageIcon, label: ar ? 'فعّالة بصور' : 'Active w/ images', value: stats.activeWithImages, tone: 'text-success' },
    { icon: ImageOff, label: ar ? 'فعّالة بدون صور' : 'Active missing images', value: stats.activeMissingImages, tone: stats.activeMissingImages > 0 ? 'text-warning' : 'text-faint' },
    { icon: Tags, label: ar ? 'بحاجة لمراجعة' : 'Needs review', value: stats.needsReview, tone: stats.needsReview > 0 ? 'text-warning' : 'text-faint' },
    { icon: Images, label: ar ? 'سجلات الصور' : 'Image records', value: stats.productImages, tone: 'text-fg' },
    { icon: CloudUpload, label: ar ? 'صور مرفوعة' : 'Uploaded images', value: stats.uploadedImages, tone: 'text-success' },
    { icon: CloudOff, label: ar ? 'رفع ناقص' : 'Missing uploads', value: stats.missingUploadedImages, tone: stats.missingUploadedImages > 0 ? 'text-warning' : 'text-faint' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
      {tiles.map((t) => (
        <div key={t.label} className="card p-3.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{t.label}</p>
            <t.icon size={14} className="text-faint" />
          </div>
          <p className={`mt-1.5 text-xl font-semibold tracking-tight ${t.tone}`}>{fmt(t.value)}</p>
        </div>
      ))}
    </div>
  );
}
