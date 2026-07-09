import Link from 'next/link';
import { Inbox, AlertTriangle, ArrowUpRight, Bot, MessageSquare } from 'lucide-react';
import { PageHeader, Card, EmptyState, Badge } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import AutoRefresh from '@/components/AutoRefresh';
import { getT } from '@/lib/i18n/server';
import { databaseStatus } from '@integrations/status';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { getDb } from '@/lib/db';
import { conversationTone } from '@/lib/status-tone';
import { humanize, timeAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';

const NEEDS_ACTION = ['needs_human', 'waiting_for_order_confirmation', 'issue_refund_exchange', 'human_active'] as const;

const FILTERS: { id: string; en: string; ar: string }[] = [
  { id: 'all', en: 'All', ar: 'الكل' },
  { id: 'action', en: 'Needs action', ar: 'يحتاج إجراء' },
  { id: 'ai', en: 'AI handling', ar: 'الذكاء يتعامل' },
  { id: 'human', en: 'Human active', ar: 'موظف نشط' },
  { id: 'resolved', en: 'Resolved', ar: 'محلولة' },
];

interface Row {
  id: string;
  channel: string;
  status: string;
  ai_enabled: boolean;
  detected_intent: string | null;
  context_summary: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  customers?: { display_name: string | null } | null;
}

export default async function InboxPage({ searchParams }: { searchParams: { filter?: string } }) {
  const { t, locale } = getT();
  const ar = locale === 'ar';
  const status = databaseStatus();
  const filter = searchParams.filter ?? 'all';

  const supabase = getDb();
  if (!supabase) {
    return (<div><PageHeader icon={Inbox} title={t('nav_inbox')} subtitle={ar ? 'محادثات ماسنجر وفيسبوك' : 'Messenger & Facebook conversations'} /><NotConnected status={status} /></div>);
  }

  let query = supabase
    .selectFrom('conversations')
    .select(['id', 'channel', 'status', 'ai_enabled', 'detected_intent', 'context_summary', 'last_message_at', 'last_message_preview', 'unread_count'])
    .select((eb) => [
      jsonObjectFrom(
        eb.selectFrom('customers').select('display_name').whereRef('customers.id', '=', 'conversations.customer_id'),
      ).as('customers'),
    ])
    .orderBy('last_message_at', (ob) => ob.desc().nullsLast())
    .limit(100);
  if (filter === 'action') query = query.where('status', 'in', [...NEEDS_ACTION]);
  else if (filter === 'ai') query = query.where('status', '=', 'ai_handling');
  else if (filter === 'human') query = query.where('status', '=', 'human_active');
  else if (filter === 'resolved') query = query.where('status', 'in', ['resolved', 'completed']);

  let rows: Row[] = [];
  let error: { message: string } | null = null;
  try {
    rows = (await query.execute()) as unknown as Row[];
  } catch (e: any) {
    error = { message: e?.message ?? 'query_failed' };
  }

  return (
    <div>
      <AutoRefresh intervalMs={10000} />
      <PageHeader icon={Inbox} title={t('nav_inbox')} subtitle={ar ? 'محادثات ماسنجر وفيسبوك' : 'Messenger & Facebook conversations'} />

      <section className="command-surface mb-4 flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
              <MessageSquare size={17} />
            </span>
            <div>
              <p className="text-sm font-semibold text-fg">{ar ? 'طابور خدمة العملاء' : 'Customer care queue'}</p>
              <p className="text-xs text-muted">{ar ? 'الأولوية للرسائل غير المقروءة وما يحتاج تدخل بشري.' : 'Unread and human-action conversations stay visually prioritized.'}</p>
            </div>
          </div>
        </div>
        <div className="relative grid grid-cols-3 gap-2 text-xs sm:w-80">
          <QueueStat label={ar ? 'المحادثات' : 'Threads'} value={rows.length} />
          <QueueStat label={ar ? 'تحتاج إجراء' : 'Action'} value={rows.filter((r) => (NEEDS_ACTION as readonly string[]).includes(r.status)).length} tone="warn" />
          <QueueStat label={ar ? 'AI يعمل' : 'AI live'} value={rows.filter((r) => r.ai_enabled).length} tone="accent" />
        </div>
      </section>

      <div className="mb-4 flex flex-wrap gap-1.5 rounded-xl border border-line/70 bg-surface/70 p-1.5 shadow-card backdrop-blur-md">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            href={`/inbox${f.id === 'all' ? '' : `?filter=${f.id}`}`}
            className={`rounded-lg border px-3.5 py-1.5 text-sm font-medium transition ${
              filter === f.id ? 'border-accent/40 bg-accent/12 text-accent shadow-glow' : 'border-transparent bg-transparent text-muted hover:bg-surface2 hover:text-fg'
            }`}
          >
            {ar ? f.ar : f.en}
          </Link>
        ))}
      </div>

      {error ? (
        <Card><p className="text-sm text-danger">{error.message}</p></Card>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={ar ? 'لا توجد محادثات' : 'No conversations'}
          hint={ar ? 'ستظهر المحادثات هنا بعد ربط ويبهوك ماسنجر/فيسبوك.' : 'Conversations appear once the Messenger/Facebook webhook is connected.'}
        />
      ) : (
        <Card pad={false} className="divide-y divide-line overflow-hidden">
          {rows.map((c) => {
            const name = c.customers?.display_name || c.context_summary?.slice(0, 40) || `#${c.id.slice(0, 8)}`;
            const needsAction = (NEEDS_ACTION as readonly string[]).includes(c.status);
            return (
              <Link key={c.id} href={`/inbox/${c.id}`} className="group flex items-center gap-3 px-4 py-3 transition hover:bg-surface2/50">
                <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface2 text-sm font-semibold text-fg shadow-card">
                  {(name[0] || '#').toUpperCase()}
                  {needsAction && <span className="absolute -end-0.5 -top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-warning text-black"><AlertTriangle size={9} /></span>}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-fg" dir="auto">{name}</p>
                    {c.unread_count > 0 && <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-black">{c.unread_count}</span>}
                  </div>
                  <p className="truncate text-xs text-muted" dir="auto">
                    {c.last_message_preview || (ar ? 'بدون رسائل' : 'No messages')}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-faint">
                    <Bot size={11} className={c.ai_enabled ? 'text-success' : 'text-faint'} />
                    {c.ai_enabled ? (ar ? 'AI مفعّل' : 'AI enabled') : (ar ? 'AI متوقف' : 'AI paused')}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <Badge tone={conversationTone(c.status)} dot>{humanize(c.status)}</Badge>
                  <span className="flex items-center gap-1 text-[11px] text-faint">
                    {humanize(c.channel)} · {timeAgo(c.last_message_at, locale)}
                    <ArrowUpRight size={13} className="opacity-0 transition group-hover:opacity-100" />
                  </span>
                </div>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function QueueStat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'warn' | 'accent' }) {
  const color = tone === 'warn' ? 'text-warning' : tone === 'accent' ? 'text-accent' : 'text-fg';
  return (
    <div className="rounded-lg border border-line bg-surface/80 px-2.5 py-2">
      <p className="truncate text-[10px] text-faint">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${color}`}>{value.toLocaleString()}</p>
    </div>
  );
}
