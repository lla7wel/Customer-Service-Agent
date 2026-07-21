import Link from 'next/link';
import { Clapperboard, ArrowUpRight } from 'lucide-react';
import { PageHeader, Card, EmptyState, Badge } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import AutoRefresh from '@/components/AutoRefresh';
import CreateContentButton from '@/components/content/CreateContentButton';
import { getT } from '@/lib/i18n/server';
import { databaseStatus } from '@integrations/status';
import { getDb } from '@/lib/db';
import { timeAgo } from '@/lib/format';
import { utcToTripoliDisplay } from '@/lib/tripoli-time';

export const dynamic = 'force-dynamic';

const FILTERS: { id: string; en: string; ar: string }[] = [
  { id: 'working', en: 'In progress', ar: 'قيد العمل' },
  { id: 'scheduled', en: 'Scheduled', ar: 'مجدول' },
  { id: 'published', en: 'Published', ar: 'منشور' },
  { id: 'failed', en: 'Problems', ar: 'مشاكل' },
  { id: 'archived', en: 'Archive', ar: 'الأرشيف' },
  { id: 'all', en: 'All', ar: 'الكل' },
];

const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'info' | 'muted'> = {
  draft: 'muted', generating: 'info', ready: 'info', approved: 'info',
  scheduled: 'info', publishing: 'info', published: 'good',
  partially_published: 'warn', failed: 'bad', archived: 'muted',
};

const STATUS_AR: Record<string, string> = {
  draft: 'مسودة', generating: 'قيد التجهيز', ready: 'جاهز', approved: 'معتمد',
  scheduled: 'مجدول', publishing: 'ينشر الآن', published: 'منشور',
  partially_published: 'منشور جزئياً', failed: 'فشل', archived: 'مؤرشف',
};

export default async function ContentStudioPage(props: { searchParams: Promise<{ filter?: string }> }) {
  const { filter = 'working' } = await props.searchParams;
  const { locale } = await getT();
  const ar = locale === 'ar';
  const db = getDb();
  if (!db) {
    return (
      <div>
        <PageHeader icon={Clapperboard} title={ar ? 'استوديو المحتوى' : 'Content Studio'} subtitle={ar ? 'منشورات وستوري فيسبوك وإنستغرام' : 'Facebook & Instagram posts and stories'} />
        <NotConnected status={databaseStatus()} />
      </div>
    );
  }

  let q = db
    .selectFrom('content_items as ci')
    .leftJoin('content_products as cp', 'cp.content_item_id', 'ci.id')
    .select((eb) => [
      'ci.id', 'ci.title', 'ci.content_type', 'ci.platforms', 'ci.purpose', 'ci.status',
      'ci.scheduled_for', 'ci.updated_at', 'ci.last_error',
      eb.fn.count<number>('cp.id').distinct().as('product_count'),
    ])
    .groupBy('ci.id')
    .orderBy('ci.updated_at', 'desc')
    .limit(80);
  if (filter === 'working') q = q.where('ci.status', 'in', ['draft', 'generating', 'ready', 'approved', 'publishing']);
  else if (filter === 'scheduled') q = q.where('ci.status', '=', 'scheduled');
  else if (filter === 'published') q = q.where('ci.status', 'in', ['published', 'partially_published']);
  else if (filter === 'failed') q = q.where('ci.status', 'in', ['failed', 'partially_published']);
  else if (filter === 'archived') q = q.where('ci.status', '=', 'archived');
  const items = await q.execute();

  return (
    <div>
      <AutoRefresh intervalMs={15000} />
      <PageHeader
        icon={Clapperboard}
        title={ar ? 'استوديو المحتوى' : 'Content Studio'}
        subtitle={ar ? 'إنشاء ونشر وجدولة محتوى فيسبوك وإنستغرام مع الرد الآلي على التعليقات' : 'Create, schedule and publish FB/IG content with automated comment replies'}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-line/70 bg-surface/70 p-1.5 shadow-card backdrop-blur-md">
          {FILTERS.map((f) => (
            <Link
              key={f.id}
              href={`/content-studio${f.id === 'working' ? '' : `?filter=${f.id}`}`}
              className={`rounded-lg border px-3.5 py-1.5 text-sm font-medium transition ${
                filter === f.id ? 'border-accent/40 bg-accent/12 text-accent shadow-glow' : 'border-transparent text-muted hover:bg-surface2 hover:text-fg'
              }`}
            >
              {ar ? f.ar : f.en}
            </Link>
          ))}
        </div>
        <CreateContentButton />
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title={ar ? 'لا يوجد محتوى هنا' : 'Nothing here yet'}
          hint={ar ? 'ابدأ بإنشاء منشور أو ستوري جديد.' : 'Start by creating a post or a story.'}
        />
      ) : (
        <Card pad={false} className="divide-y divide-line overflow-hidden">
          {items.map((c) => (
            <Link key={c.id} href={`/content-studio/${c.id}`} className="group flex items-center gap-3 px-4 py-3 transition hover:bg-surface2/50">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface2 text-lg">
                {c.content_type === 'story' ? '📱' : '🖼️'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg" dir="auto">
                  {c.title || (ar ? 'بدون عنوان' : 'Untitled')}
                </p>
                <p className="truncate text-xs text-muted">
                  {(c.platforms ?? []).map((p) => (p === 'facebook' ? 'Facebook' : 'Instagram')).join(' + ') || '—'}
                  {' · '}
                  {c.purpose === 'price_drop' ? (ar ? 'تخفيض سعر' : 'Price drop') : (ar ? 'محتوى عام' : 'General')}
                  {' · '}
                  {Number(c.product_count)} {ar ? 'منتج' : 'products'}
                </p>
                {c.last_error && <p className="mt-0.5 truncate text-xs text-danger">{c.last_error}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <Badge tone={STATUS_TONE[c.status] ?? 'muted'} dot>
                  {ar ? (STATUS_AR[c.status] ?? c.status) : c.status.replace(/_/g, ' ')}
                </Badge>
                <span className="flex items-center gap-1 text-[11px] text-faint" dir="auto">
                  {c.status === 'scheduled' && c.scheduled_for
                    ? utcToTripoliDisplay(c.scheduled_for)
                    : timeAgo(c.updated_at, locale)}
                  <ArrowUpRight size={13} className="opacity-0 transition group-hover:opacity-100" />
                </span>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
