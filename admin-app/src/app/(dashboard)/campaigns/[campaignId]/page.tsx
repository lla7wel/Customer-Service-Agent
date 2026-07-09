import Link from 'next/link';
import { ArrowLeft, Eye, Percent, CalendarClock, ImageOff } from 'lucide-react';
import { Card, Badge, Notice, SectionTitle } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import { getT } from '@/lib/i18n/server';
import { supabaseStatus, metaStatus } from '@integrations/status';
import { fetchOne, fetchRows } from '@/lib/data';
import { campaignTone } from '@/lib/status-tone';
import { humanize, formatDate } from '@/lib/format';
import type { Campaign } from '@integrations/supabase/types';
import AssetManager from '@/components/campaigns/AssetManager';
import CaptionPanel from '@/components/campaigns/CaptionPanel';
import PostComposer from '@/components/campaigns/PostComposer';

export const dynamic = 'force-dynamic';

interface Asset { id: string; kind: string; public_url: string | null; position: number; approved?: boolean; source_asset_id?: string | null }
interface Post { id: string; type: string; status: string; asset_ids: string[]; fb_post_id: string | null; permalink_url: string | null; scheduled_for: string | null; error: string | null }

export default async function CampaignDetailPage({ params }: { params: { campaignId: string } }) {
  const { locale } = getT();
  const ar = locale === 'ar';
  const status = supabaseStatus();
  if (!status.configured) return (<div><Back ar={ar} /><NotConnected status={status} /></div>);

  const [{ row: campaign }, assetsRes, postsRes] = await Promise.all([
    fetchOne<Campaign>('campaigns', params.campaignId),
    fetchRows<Asset>('campaign_assets', (q) => q.eq('campaign_id', params.campaignId).order('position', { ascending: true })),
    fetchRows<Post>('facebook_posts', (q) => q.eq('campaign_id', params.campaignId).order('created_at', { ascending: true })),
  ]);

  if (!campaign) return (<div><Back ar={ar} /><Notice tone="error">{ar ? 'الحملة غير موجودة' : 'Campaign not found'}</Notice></div>);

  const assets = assetsRes.rows;
  const posts = postsRes.rows;
  const approved = assets.filter((a) => a.public_url && a.approved);
  const previewImg =
    approved[0]?.public_url ??
    assets.find((a) => a.public_url && a.kind === 'ai_edited_image')?.public_url ??
    assets.find((a) => a.public_url)?.public_url ??
    null;

  return (
    <div>
      <Back ar={ar} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface2 text-accent">
            <CalendarClock size={20} />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-fg" dir="auto">{campaign.name}</h1>
            <p className="text-xs text-muted">{humanize(campaign.type)}</p>
          </div>
        </div>
        <Badge tone={campaignTone(campaign.status)} dot>{humanize(campaign.status)}</Badge>
      </div>

      {!metaStatus().configured && (
        <div className="mb-4"><Notice tone="warn">{ar ? 'Meta غير مربوط — يمكنك تجهيز الحملة والمنشورات، لكن النشر يحتاج إعداد Meta.' : 'Meta not connected — you can prepare everything, but publishing needs Meta configured.'}</Notice></div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* builder */}
        <div className="space-y-5">
          <AssetManager campaignId={campaign.id} assets={assets} locale={locale} />
          <CaptionPanel campaignId={campaign.id} caption={campaign.generated_caption} captionPrompt={(campaign as any).caption_prompt ?? null} designPrompt={(campaign as any).design_prompt ?? null} locale={locale} />
          <PostComposer campaignId={campaign.id} assetCount={assets.filter((a) => a.public_url).length} posts={posts} locale={locale} />
        </div>

        {/* right rail: details + live preview */}
        <aside className="space-y-5">
          <Card>
            <SectionTitle title={ar ? 'تفاصيل الحملة' : 'Campaign details'} />
            <dl className="space-y-2.5 text-sm">
              <Row icon={Percent} label={ar ? 'الخصم' : 'Discount'} value={campaign.discount_percent != null ? `${campaign.discount_percent}%` : '—'} />
              <Row icon={CalendarClock} label={ar ? 'البداية' : 'Starts'} value={formatDate(campaign.starts_at, locale)} />
              <Row icon={CalendarClock} label={ar ? 'النهاية' : 'Ends'} value={formatDate(campaign.ends_at, locale)} />
            </dl>
          </Card>

          <Card>
            <SectionTitle icon={Eye} title={ar ? 'معاينة المنشور' : 'Post preview'} />
            <div className="overflow-hidden rounded-xl border border-line bg-surface2">
              <div className="flex items-center gap-2 p-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-grad text-[11px] font-bold text-black">EH</span>
                <div className="leading-tight">
                  <p className="text-xs font-semibold text-fg">English Home Libya</p>
                  <p className="text-[10px] text-faint">{ar ? 'مُموَّل · الآن' : 'Sponsored · now'}</p>
                </div>
              </div>
              {campaign.generated_caption && (
                <p className="px-3 pb-2 text-sm text-fg" dir="auto">{campaign.generated_caption}</p>
              )}
              <div className="aspect-square bg-bg">
                {previewImg ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewImg} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-faint">
                    <ImageOff size={26} />
                    <p className="mt-1 text-xs">{ar ? 'أضف صورة للمعاينة' : 'Add an image to preview'}</p>
                  </div>
                )}
              </div>
            </div>
            <p className="mt-2 text-xs text-faint">{ar ? 'معاينة تقريبية لشكل المنشور على فيسبوك.' : 'Approximate preview of the Facebook post.'}</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-muted"><Icon size={14} className="text-faint" />{label}</dt>
      <dd className="text-end text-fg">{value}</dd>
    </div>
  );
}
function Back({ ar }: { ar: boolean }) {
  return (
    <Link href="/campaigns" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg">
      <ArrowLeft size={15} className="rtl-flip" /> {ar ? 'رجوع للحملات' : 'Back to campaigns'}
    </Link>
  );
}
