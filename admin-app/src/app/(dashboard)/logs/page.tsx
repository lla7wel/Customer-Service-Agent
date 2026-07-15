import {
  ScrollText, User, Bot, Cog, MessageSquare, Package, Megaphone, Share2,
  AlertTriangle, Database,
} from 'lucide-react';
import { PageHeader, Card, EmptyState, Badge } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import { getT } from '@/lib/i18n/server';
import { databaseStatus } from '@integrations/status';
import { fetchRows } from '@/lib/data';
import { activityLabel, activitySummary, formatDate, humanize } from '@/lib/format';
import type { ActivityLog } from '@integrations/db/rows';

export const dynamic = 'force-dynamic';

const ICON: Record<string, any> = {
  human_message: MessageSquare,
  product_edit: Package,
  product_match: Package,
  campaign_created: Megaphone,
  campaign_generated: Megaphone,
  campaign_image_edit_generated: Megaphone,
  campaign_image_edit_failed: AlertTriangle,
  fb_post: Share2,
  ai_settings_updated: Cog,
  order_draft_created: Package,
  import: Database,
};

export default async function LogsPage() {
  const { t, locale } = await getT();
  const ar = locale === 'ar';
  const status = databaseStatus();
  const { connected, rows, error } = await fetchRows<ActivityLog>('activity_logs', (q) => q.orderBy('created_at', 'desc').limit(150));

  return (
    <div>
      <PageHeader icon={ScrollText} title={t('nav_logs')} subtitle={ar ? 'سجل النشاط عبر النظام' : 'Activity feed across the system'} />

      {!connected ? (
        <NotConnected status={status} />
      ) : error ? (
        <Card><p className="text-sm text-danger">{error}</p></Card>
      ) : rows.length === 0 ? (
        <EmptyState icon={ScrollText} title={ar ? 'لا يوجد نشاط بعد' : 'No activity yet'} hint={ar ? 'تُسجَّل رسائل الموظف وتعديلات المنتجات والحملات والمنشورات هنا.' : 'Human messages, product edits, campaigns and posts are logged here.'} />
      ) : (
        <Card pad={false} className="overflow-hidden">
          <ul className="divide-y divide-line">
            {rows.map((l) => {
              const Icon = ICON[l.action] || (l.actor_type === 'ai' ? Bot : l.actor_type === 'human' ? User : AlertTriangle);
              const summary = activitySummary(l.summary);
              return (
                <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${l.actor_type === 'ai' ? 'bg-accent/12 text-accent' : l.actor_type === 'human' ? 'bg-info/12 text-info' : 'bg-surface2 text-faint'}`}>
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg">{activityLabel(l.action, locale)}</p>
                    {summary && <p className="line-clamp-2 text-xs text-muted" dir="auto">{summary}</p>}
                  </div>
                  <Badge tone={l.actor_type === 'ai' ? 'accent' : l.actor_type === 'human' ? 'info' : 'neutral'}>{humanize(l.actor_type)}</Badge>
                  <span className="shrink-0 text-xs text-faint">{formatDate(l.created_at, locale)}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
