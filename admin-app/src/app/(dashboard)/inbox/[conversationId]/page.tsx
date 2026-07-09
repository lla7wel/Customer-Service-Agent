import Link from 'next/link';
import { ArrowLeft, AlertTriangle, MessageSquare } from 'lucide-react';
import { Badge, EmptyState } from '@/components/ui';
import NotConnected from '@/components/NotConnected';
import { getT } from '@/lib/i18n/server';
import { databaseStatus } from '@integrations/status';
import { fetchOne, fetchRows } from '@/lib/data';
import { conversationTone } from '@/lib/status-tone';
import { humanize, formatDate } from '@/lib/format';
import type { Conversation, Message, Customer } from '@integrations/db/rows';
import ConversationWorkspace from '@/components/inbox/ConversationWorkspace';
import AiControls from '@/components/inbox/AiControls';
import CustomerInfoPanel from '@/components/inbox/CustomerInfoPanel';
import CustomerMemoryPanel from '@/components/inbox/CustomerMemoryPanel';
import { getDb } from '@integrations/db/client';
import { getCustomerMemory } from '@integrations/tools';
import { hydrateMessagesWithCandidates, hydrateUiCandidates, type UiCandidate } from '@/lib/product-candidates';

export const dynamic = 'force-dynamic';

export default async function ConversationPage(props: { params: Promise<{ conversationId: string }> }) {
  const params = await props.params;
  const { locale } = await getT();
  const ar = locale === 'ar';
  const status = databaseStatus();
  const id = params.conversationId;

  if (!status.configured) {
    return (<div><Back ar={ar} /><NotConnected status={status} /></div>);
  }

  const [{ row: convo }, msgs] = await Promise.all([
    fetchOne<Conversation>('conversations', id),
    fetchRows<Message>('messages', (q) => q.where('conversation_id', '=', id).orderBy('created_at', 'asc').limit(200)),
  ]);

  if (!convo) {
    return (<div><Back ar={ar} /><EmptyState icon={MessageSquare} title={ar ? 'المحادثة غير موجودة' : 'Conversation not found'} hint={ar ? 'ستظهر المحادثات بعد ربط الويبهوك.' : 'Conversations appear after the webhook is connected.'} /></div>);
  }

  const customer = convo.customer_id ? (await fetchOne<Customer>('customers', convo.customer_id)).row : null;
  const title = customer?.display_name || convo.context_summary?.slice(0, 40) || `#${convo.id.slice(0, 8)}`;

  // Surface image-match candidates from the latest message that carries them.
  const extractCands = (meta: unknown): Cand[] => {
    const c = (meta as any)?.candidates;
    return Array.isArray(c) ? (c as Cand[]) : [];
  };
  type Cand = UiCandidate;
  let candidates: Cand[] = [];
  for (let i = msgs.rows.length - 1; i >= 0; i--) {
    const c = extractCands(msgs.rows[i].ai_meta);
    if (c.length) { candidates = c; break; }
  }
  const db = getDb();
  const safeMessages = db ? await hydrateMessagesWithCandidates(db, msgs.rows) : msgs.rows;
  if (db && candidates.length) candidates = await hydrateUiCandidates(db, candidates);
  const memory = db && convo.customer_id ? await getCustomerMemory(db, convo.customer_id) : null;

  return (
    <div>
      <Back ar={ar} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent-grad text-sm font-bold text-black">
            {(title[0] || '#').toUpperCase()}
          </span>
          <div>
            <h1 className="text-lg font-semibold text-fg" dir="auto">{title}</h1>
            <p className="text-xs text-muted">{humanize(convo.channel)} · {ar ? 'النية' : 'intent'}: {convo.detected_intent || '—'}</p>
          </div>
        </div>
        <Badge tone={conversationTone(convo.status)} dot>{humanize(convo.status)}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        {/* chat workspace */}
        <ConversationWorkspace
          conversationId={convo.id}
          aiEnabled={convo.ai_enabled}
          locale={locale}
          candidates={candidates}
          initialMessages={safeMessages.map((m) => ({
            id: m.id, direction: m.direction, sender_type: m.sender_type,
            body: m.body, is_internal_suggestion: m.is_internal_suggestion, created_at: m.created_at,
            delivered_at: ((m as any).delivered_at ?? null) as string | null,
            attachments: ((m as any).attachments ?? []) as { type?: string; url?: string }[],
            ai_meta: ((m as any).ai_meta ?? {}) as Record<string, unknown>,
          }))}
        />

        {/* right rail */}
        <aside className="space-y-4">
          <AiControls conversationId={convo.id} aiEnabled={convo.ai_enabled} locale={locale} />

          <CustomerMemoryPanel conversationId={convo.id} memory={memory} locale={locale} />


          {(!convo.ai_enabled || convo.status === 'needs_human') && (
            <div className="card border-warning/30 bg-warning/5 p-4">
              <div className="mb-1.5 flex items-center gap-2">
                <AlertTriangle size={15} className="text-warning" />
                <h3 className="text-sm font-semibold text-warning">{ar ? 'يحتاج متابعة موظف' : 'Needs human follow-up'}</h3>
              </div>
              <Badge tone="warn">{convo.ai_enabled ? humanize(convo.status) : (ar ? 'الذكاء متوقف' : 'AI paused')}</Badge>
              {(convo.detected_intent || convo.context_summary) && (
                <p className="mt-2 text-sm text-fg" dir="auto">{convo.context_summary || humanize(convo.detected_intent || '')}</p>
              )}
            </div>
          )}

          <CustomerInfoPanel
            locale={locale}
            customer={customer}
            conversation={{
              status: convo.status,
              ai_enabled: convo.ai_enabled,
              channel: convo.channel,
              customer_language: convo.customer_language,
              detected_intent: convo.detected_intent,
              last_message_at: formatDate(convo.last_message_at, locale),
            }}
          />
        </aside>
      </div>
    </div>
  );
}

function Back({ ar }: { ar: boolean }) {
  return (
    <Link href="/inbox" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg">
      <ArrowLeft size={15} className="rtl-flip" /> {ar ? 'رجوع للرسائل' : 'Back to inbox'}
    </Link>
  );
}
