import { User, Phone, MapPin, StickyNote, Tag, Bot, CircleDot } from 'lucide-react';
import { Card } from '@/components/ui';
import { humanize } from '@/lib/format';
import type { Locale } from '@/lib/i18n/config';

interface CustomerLite {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  profile_pic_url?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  notes?: string | null;
  tags?: string[] | null;
}

interface ConvoLite {
  status: string;
  ai_enabled: boolean;
  channel: string;
  customer_language?: string | null;
  detected_intent?: string | null;
  last_message_at?: string | null;
}

/**
 * Customer info + conversation state for the inbox right rail. Shows everything
 * the agent needs at a glance: who the customer is, contact details, AI/handoff
 * state, and conversation status.
 */
export default function CustomerInfoPanel({
  customer,
  conversation,
  locale,
}: {
  customer: CustomerLite | null;
  conversation: ConvoLite;
  locale: Locale;
}) {
  const ar = locale === 'ar';
  const name = customer?.display_name
    || [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim()
    || (ar ? 'عميل' : 'Customer');
  const tags = (customer?.tags ?? []).filter(Boolean);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <User size={15} className="text-accent" />
        <h3 className="text-sm font-semibold text-fg">{ar ? 'معلومات العميل' : 'Customer'}</h3>
      </div>

      {/* identity */}
      <div className="mb-3 flex items-center gap-3">
        <span className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-surface2 ring-1 ring-line">
          {customer?.profile_pic_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={customer.profile_pic_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-faint"><User size={20} /></span>
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg" dir="auto">{name}</p>
          <p className="text-xs text-muted">{humanize(conversation.channel)}</p>
        </div>
      </div>

      {/* state chips */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${conversation.ai_enabled ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}>
          <Bot size={11} /> {conversation.ai_enabled ? (ar ? 'الذكاء فعّال' : 'AI active') : (ar ? 'الذكاء متوقف' : 'AI paused')}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-surface2 px-2 py-0.5 text-[11px] font-medium text-muted">
          <CircleDot size={11} /> {humanize(conversation.status)}
        </span>
      </div>

      {/* details */}
      <dl className="space-y-2 text-sm">
        {customer?.phone && <Detail icon={Phone} value={customer.phone} />}
        {(customer?.address || customer?.city) && (
          <Detail icon={MapPin} value={[customer?.address, customer?.city].filter(Boolean).join('، ')} />
        )}
        {customer?.notes && <Detail icon={StickyNote} value={customer.notes} />}
        <KV label={ar ? 'اللغة' : 'Language'} value={conversation.customer_language || '—'} />
        <KV label={ar ? 'النية' : 'Intent'} value={conversation.detected_intent || '—'} />
        <KV label={ar ? 'آخر رسالة' : 'Last message'} value={conversation.last_message_at || '—'} />
      </dl>

      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
              <Tag size={10} /> {t}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

function Detail({ icon: Icon, value }: { icon: typeof Phone; value: string }) {
  return (
    <div className="flex items-start gap-2 text-fg">
      <Icon size={14} className="mt-0.5 shrink-0 text-faint" />
      <span className="min-w-0 wrap-break-word" dir="auto">{value}</span>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-end text-fg" dir="auto">{value}</dd>
    </div>
  );
}
