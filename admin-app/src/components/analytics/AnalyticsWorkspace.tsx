'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { ArrowUpRight, ArrowDownRight, Minus, Loader2, RefreshCw } from 'lucide-react';
import type { AnalyticsBundle, Channel, MetricSeries } from '@integrations/pipelines/analytics-query';

const METRIC_LABELS: Record<string, string> = {
  inbound_messages: 'الرسائل الواردة',
  ai_replies: 'ردود الذكاء',
  human_replies: 'ردود بشرية',
  active_conversations: 'محادثات نشطة',
  order_handoffs: 'تحويلات واتساب',
  delivery_failures: 'فشل/شك التسليم',
  content_published: 'منشورات ناجحة',
  content_failed: 'نشر فاشل',
  comment_replies: 'ردود التعليقات',
  comment_reply_failures: 'ردود تعليقات فاشلة',
};
const PROVIDER_LABELS: Record<string, string> = {
  facebook_page_engagements: 'تفاعلات صفحة فيسبوك',
  facebook_page_views: 'مشاهدات صفحة فيسبوك',
  instagram_reach: 'وصول إنستغرام',
  instagram_views: 'مشاهدات إنستغرام',
  instagram_interactions: 'تفاعلات إنستغرام',
};
const CARD_METRICS = [
  'inbound_messages', 'ai_replies', 'human_replies', 'active_conversations',
  'order_handoffs', 'delivery_failures', 'content_published', 'comment_replies',
];
const PLOTTABLE = ['inbound_messages', 'ai_replies', 'human_replies', 'active_conversations'];
const PRESETS = [
  { days: 7, label: '٧ أيام' },
  { days: 30, label: '٣٠ يوم' },
  { days: 90, label: '٩٠ يوم' },
];
const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'all', label: 'كل القنوات' },
  { value: 'messenger', label: 'ماسنجر' },
  { value: 'instagram', label: 'إنستغرام' },
];

const nf = new Intl.NumberFormat('en-US');

function shortDay(d: string) { return d.slice(5); } // MM-DD

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="inline-flex items-center gap-1 text-xs text-faint"><Minus size={12} /> جديد</span>;
  const up = pct >= 0;
  const Icon = pct === 0 ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const tone = pct === 0 ? 'text-faint' : up ? 'text-success' : 'text-danger';
  return <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${tone}`}><Icon size={12} />{Math.abs(pct).toFixed(0)}%</span>;
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${28 - (v / max) * 26}`).join(' ');
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-full" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MetricCard({ series }: { series: MetricSeries }) {
  const label = METRIC_LABELS[series.metric] ?? series.metric;
  return (
    <div className="card overflow-hidden p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        <DeltaBadge pct={series.changePct} />
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-fg">
        {series.total != null ? nf.format(series.total) : '—'}
      </p>
      <div className="mt-2"><Sparkline values={series.values} /></div>
      {series.kind === 'unique' && <p className="mt-1 text-[10px] text-faint">عدد فريد على المدى (لا يُجمع يومياً)</p>}
    </div>
  );
}

export default function AnalyticsWorkspace({ initial, locale }: { initial: AnalyticsBundle; locale: string }) {
  const [bundle, setBundle] = useState<AnalyticsBundle>(initial);
  const [days, setDays] = useState<number>(7);
  const [channel, setChannel] = useState<Channel>('all');
  const [plot, setPlot] = useState<string>('inbound_messages');
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  async function refresh(nextDays: number, nextChannel: Channel) {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics?days=${nextDays}&channel=${nextChannel}`, { cache: 'no-store' });
      if (res.ok) setBundle(await res.json());
    } finally { setLoading(false); }
  }

  const chartData = useMemo(() => {
    const s = bundle.metrics[plot];
    if (!s) return [];
    return s.days.map((d, i) => ({ day: shortDay(d), value: s.values[i] }));
  }, [bundle, plot]);

  const providerAvailable = bundle.provider.some((p) => p.available);

  return (
    <div className="space-y-5">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {PRESETS.map((p) => (
            <button
              key={p.days}
              onClick={() => { setDays(p.days); refresh(p.days, channel); }}
              className={`min-h-9 rounded-md px-3 text-xs font-medium transition ${days === p.days ? 'bg-accent text-white' : 'text-muted hover:text-fg'}`}
            >{p.label}</button>
          ))}
        </div>
        <select
          value={channel}
          onChange={(e) => { const c = e.target.value as Channel; setChannel(c); refresh(days, c); }}
          className="min-h-9 rounded-lg border border-line bg-surface px-3 text-xs text-fg outline-none focus:border-accent/50"
        >
          {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button
          onClick={() => refresh(days, channel)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-muted transition hover:text-fg"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} تحديث
        </button>
        <span className="ms-auto text-[11px] text-faint">
          المصدر: بيانات محلية · توقيت طرابلس · حتى {new Date(bundle.meta.generatedAt).toLocaleString(locale === 'ar' ? 'ar-LY' : 'en-GB', { timeZone: 'Africa/Tripoli', dateStyle: 'short', timeStyle: 'short' })}
        </span>
      </div>

      {/* metric cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {CARD_METRICS.map((m) => bundle.metrics[m] && <MetricCard key={m} series={bundle.metrics[m]} />)}
      </div>

      {/* main trend chart */}
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-fg">الاتجاه اليومي</h2>
          <div className="flex flex-wrap gap-1">
            {PLOTTABLE.map((m) => bundle.metrics[m] && (
              <button
                key={m}
                onClick={() => setPlot(m)}
                className={`min-h-8 rounded-md px-2.5 text-xs font-medium transition ${plot === m ? 'bg-accent/12 text-accent' : 'text-muted hover:text-fg'}`}
              >{METRIC_LABELS[m]}</button>
            ))}
          </div>
        </div>
        <div className="h-64 w-full" role="img" aria-label={`الاتجاه اليومي: ${METRIC_LABELS[plot] ?? plot}`}>
          {mounted && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="area-accent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent, #1e3a5f)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--accent, #1e3a5f)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #e5e0d8)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="var(--muted, #9a9488)" minTickGap={16} />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted, #9a9488)" allowDecimals={false} width={40} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid var(--line,#e5e0d8)' }} />
                <Area type="monotone" dataKey="value" name={METRIC_LABELS[plot] ?? plot} stroke="var(--accent, #1e3a5f)" strokeWidth={2} fill="url(#area-accent)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* provider insights */}
      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-fg">مؤشرات فيسبوك / إنستغرام</h2>
        {!providerAvailable ? (
          <p className="rounded-lg border border-line bg-surface2/50 p-4 text-xs text-muted">
            غير متوفرة بعد — تظهر عندما يملك رمز الصفحة صلاحية <span className="font-mono">read_insights</span> وينجح المزامنة. لا نعرض أصفاراً وهمية.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {bundle.provider.filter((p) => p.available).map((p) => (
              <div key={p.metric} className="rounded-lg border border-line bg-surface2/40 p-3">
                <p className="text-xs text-muted">{PROVIDER_LABELS[p.metric] ?? p.metric}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-fg">{p.total != null ? nf.format(p.total) : '—'}</p>
                {p.total == null && p.kind === 'unique' && <p className="mt-0.5 text-[10px] text-faint">الوصول لا يُجمع يومياً — يلزم إجمالي المزود</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
