import {
  BarChart3, Inbox, AlertTriangle, ImageIcon, ImageOff,
  Megaphone, Bot, Gauge,
} from 'lucide-react';
import { PageHeader, Card, StatCard, SectionTitle, Meter } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import { getT } from '@/lib/i18n/server';
import { databaseStatus } from '@integrations/status';
import { countRows } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const { t, locale } = getT();
  const ar = locale === 'ar';
  const status = databaseStatus();

  const [conversations, needsHuman, matches, failedMatches, campaigns, aiErrors, aiOk] = await Promise.all([
    countRows('conversations'),
    countRows('conversations', (q) => q.where('status', 'in', ['needs_human', 'human_active', 'issue_refund_exchange'])),
    countRows('image_match_corrections', (q) => q.where('outcome', '!=', 'none')),
    countRows('image_match_corrections', (q) => q.where('outcome', '=', 'none')),
    countRows('facebook_posts', (q) => q.where('status', '=', 'published')),
    countRows('ai_events', (q) => q.where('success', '=', false)),
    countRows('ai_events', (q) => q.where('success', '=', true)),
  ]);

  const v = (r: { connected: boolean; count: number | null }) => (!r.connected ? '—' : (r.count ?? 0).toString());
  const totalConv = conversations.count ?? 0;
  const needs = needsHuman.count ?? 0;
  const needsHumanRate = totalConv > 0 ? Math.round((needs / totalConv) * 100) : null;
  const aiTotal = (aiOk.count ?? 0) + (aiErrors.count ?? 0);
  const aiRate = aiTotal > 0 ? Math.round(((aiOk.count ?? 0) / aiTotal) * 100) : null;

  return (
    <div>
      <PageHeader icon={BarChart3} title={t('nav_analytics')} subtitle={ar ? 'المؤشر الرئيسي: متابعة الموظف عند الحاجة' : 'Main KPI: human follow-up when needed'} />

      {!status.configured ? (
        <NotConnected status={status} />
      ) : (
        <>
          {/* headline KPIs */}
          <div className="mb-5 grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle icon={AlertTriangle} title={ar ? 'محادثات تحتاج موظف' : 'Needs-human rate'} />
              <div className="flex items-end justify-between">
                <span className="text-4xl font-semibold tracking-tight text-fg">{needsHumanRate != null ? `${needsHumanRate}%` : '—'}</span>
                <span className="text-sm text-muted">{needs} / {totalConv} {ar ? 'محادثة' : 'conversations'}</span>
              </div>
              <div className="mt-3"><Meter value={needsHumanRate ?? 0} tone={needsHumanRate != null && needsHumanRate > 40 ? 'bad' : needsHumanRate != null && needsHumanRate > 20 ? 'warn' : 'good'} /></div>
            </Card>
            <Card>
              <SectionTitle icon={Gauge} title={ar ? 'نسبة نجاح الذكاء' : 'AI success rate'} />
              <div className="flex items-end justify-between">
                <span className="text-4xl font-semibold tracking-tight text-fg">{aiRate != null ? `${aiRate}%` : '—'}</span>
                <span className="text-sm text-muted">{aiTotal} {ar ? 'عملية' : 'events'}</span>
              </div>
              <div className="mt-3"><Meter value={aiRate ?? 0} tone={aiRate != null && aiRate < 80 ? 'warn' : 'good'} /></div>
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={Inbox} label={ar ? 'إجمالي المحادثات' : 'Total conversations'} value={v(conversations)} />
            <StatCard icon={AlertTriangle} label={ar ? 'يحتاج موظف' : 'Needs human'} value={v(needsHuman)} tone="warn" />
            <StatCard icon={ImageIcon} label={ar ? 'مطابقات الصور' : 'Image matches'} value={v(matches)} tone="good" />
            <StatCard icon={ImageOff} label={ar ? 'مطابقات فاشلة' : 'Failed matches'} value={v(failedMatches)} tone="warn" />
            <StatCard icon={Megaphone} label={ar ? 'حملات منشورة' : 'Campaigns published'} value={v(campaigns)} />
            <StatCard icon={Bot} label={ar ? 'أخطاء الذكاء' : 'AI errors'} value={v(aiErrors)} tone={(aiErrors.count ?? 0) > 0 ? 'bad' : 'muted'} />
          </div>

          <Card className="mt-4">
            <p className="text-sm text-muted">
              {ar ? 'متوسط زمن الرد' : 'Average response time'}: <span className="text-faint">{ar ? 'يُحسب لاحقاً عبر تجميع البيانات' : 'computed later via rollups'}</span>
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
