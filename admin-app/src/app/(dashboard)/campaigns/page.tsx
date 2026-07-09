import Link from 'next/link';
import { Megaphone, Plus, Percent, CalendarClock, ImageOff, Images, Sparkles } from 'lucide-react';
import { PageHeader, Card, EmptyState, Badge } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import { getT } from '@/lib/i18n/server';
import { databaseStatus } from '@integrations/status';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { getDb } from '@/lib/db';
import { campaignTone } from '@/lib/status-tone';
import { humanize, formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  name: string;
  type: string;
  status: string;
  discount_percent: number | null;
  starts_at: string | null;
  campaign_assets?: { public_url: string | null }[];
}

export default async function CampaignsPage() {
  const { t, locale } = await getT();
  const ar = locale === 'ar';
  const status = databaseStatus();
  const supabase = getDb();

  const newBtn = (
    <Link href="/campaigns/new" className="btn-primary"><Plus size={16} /> {ar ? 'حملة جديدة' : 'New campaign'}</Link>
  );

  if (!supabase) {
    return (<div><PageHeader icon={Megaphone} title={t('nav_campaigns')} subtitle={ar ? 'منشئ الحملات التسويقية' : 'Marketing campaign builder'} actions={newBtn} /><NotConnected status={status} /></div>);
  }

  let rows: Row[] = [];
  let error: { message: string } | null = null;
  try {
    rows = (await supabase
      .selectFrom('campaigns')
      .select(['id', 'name', 'type', 'status', 'discount_percent', 'starts_at'])
      .select((eb) => [
        jsonArrayFrom(
          eb.selectFrom('campaign_assets').select('public_url').whereRef('campaign_assets.campaign_id', '=', 'campaigns.id'),
        ).as('campaign_assets'),
      ])
      .orderBy('created_at', 'desc')
      .limit(60)
      .execute()) as unknown as Row[];
  } catch (e: any) {
    error = { message: e?.message ?? 'query_failed' };
  }

  return (
    <div>
      <PageHeader icon={Megaphone} title={t('nav_campaigns')} subtitle={ar ? 'منشئ الحملات التسويقية' : 'Marketing campaign builder'} actions={newBtn} />

      <section className="command-surface mb-5 grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="relative flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
            <Sparkles size={19} />
          </span>
          <div>
            <p className="text-sm font-semibold text-fg">{ar ? 'استوديو الحملات' : 'Campaign studio'}</p>
            <p className="text-xs text-muted">{ar ? 'جهّز الصور، الخصومات، والتوقيت قبل النشر.' : 'Prepare creative assets, discounts, and timing before publishing.'}</p>
          </div>
        </div>
        <div className="relative grid grid-cols-3 gap-2 text-xs lg:w-96">
          <CampaignStat label={ar ? 'الحملات' : 'Campaigns'} value={rows.length} />
          <CampaignStat label={ar ? 'بصور' : 'With assets'} value={rows.filter((r) => r.campaign_assets?.some((a) => a.public_url)).length} />
          <CampaignStat label={ar ? 'مجدولة' : 'Scheduled'} value={rows.filter((r) => r.status === 'scheduled' || r.status === 'publishing').length} tone="accent" />
        </div>
      </section>

      {error ? (
        <Card><p className="text-sm text-danger">{error.message}</p></Card>
      ) : rows.length === 0 ? (
        <EmptyState icon={Megaphone} title={ar ? 'لا توجد حملات بعد' : 'No campaigns yet'} hint={ar ? 'أنشئ حملتك الأولى وابدأ برفع الصور وتوليد التعليق.' : 'Create your first campaign, upload images, and generate a caption.'} action={newBtn} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => {
            const cover = c.campaign_assets?.find((a) => a.public_url)?.public_url ?? null;
            return (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="card tilt-card group overflow-hidden p-0 transition hover:border-accent/40 hover:shadow-glow">
                <div className="relative aspect-video bg-surface2">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-faint"><ImageOff size={26} /></div>
                  )}
                  <span className="absolute inset-e-2 top-2"><Badge tone={campaignTone(c.status)}>{humanize(c.status)}</Badge></span>
                  <span className="absolute inset-s-2 bottom-2 inline-flex items-center gap-1 rounded-sm bg-black/55 px-2 py-1 text-[10px] text-white">
                    <Images size={11} /> {(c.campaign_assets ?? []).filter((a) => a.public_url).length}
                  </span>
                </div>
                <div className="p-4">
                  <p className="truncate text-sm font-semibold text-fg" dir="auto">{c.name}</p>
                  <p className="text-xs text-muted">{humanize(c.type)}</p>
                  <div className="mt-3 flex items-center justify-between text-xs text-faint">
                    <span className="inline-flex items-center gap-1">{c.discount_percent != null ? <><Percent size={12} />{c.discount_percent}%</> : '—'}</span>
                    <span className="inline-flex items-center gap-1"><CalendarClock size={12} />{c.starts_at ? formatDate(c.starts_at, locale) : '—'}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CampaignStat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'accent' }) {
  return (
    <div className="rounded-lg border border-line bg-surface/80 px-2.5 py-2">
      <p className="truncate text-[10px] text-faint">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${tone === 'accent' ? 'text-accent' : 'text-fg'}`}>{value.toLocaleString()}</p>
    </div>
  );
}
