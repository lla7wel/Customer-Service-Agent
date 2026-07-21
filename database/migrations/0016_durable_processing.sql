-- =============================================================================
-- 0016 — Durable event ingestion, jobs, transactional outbox
-- =============================================================================
-- Replaces in-request webhook processing + in-memory debounce with durable
-- processing (audit findings EH-001/002/007/010/011/015/016):
--
--   inbound_events   every verified webhook event is persisted BEFORE the 200.
--   jobs             PostgreSQL-backed queue claimed with FOR UPDATE SKIP LOCKED.
--   outbox_messages  outgoing messages recorded durably before provider calls,
--                    with idempotency keys and truthful delivery states.
--
-- Also enforces conversation invariants at the DB level:
--   * one active conversation per customer (partial unique index; older
--     duplicates are closed, never deleted), and
--   * truthful per-message delivery status.
--
-- Idempotent and forward-only.
-- =============================================================================

-- 1. Inbound provider events --------------------------------------------------
create table if not exists inbound_events (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null default 'meta',
  topic              text not null,               -- 'messenger'|'instagram'|'feed'|'comments'|...
  provider_event_key text,                        -- message mid / comment id when present
  payload            jsonb not null,
  status             text not null default 'pending'
                     check (status in ('pending','processed','skipped','failed','dead')),
  attempts           int not null default 0,
  last_error         text,
  received_at        timestamptz not null default now(),
  processed_at       timestamptz
);
-- Provider redeliveries of the same event must be no-ops.
create unique index if not exists uq_inbound_events_provider_key
  on inbound_events (provider, topic, provider_event_key)
  where provider_event_key is not null;
create index if not exists idx_inbound_events_pending
  on inbound_events (received_at) where status = 'pending';

-- 2. Jobs ---------------------------------------------------------------------
create table if not exists jobs (
  id               uuid primary key default gen_random_uuid(),
  job_type         text not null,                 -- 'ingest_event'|'customer_turn'|'outbox_deliver'|'content_publish'|'comments_poll'|'promotion_tick'|'analytics_refresh'|'csv_import'|...
  dedupe_key       text,
  payload          jsonb not null default '{}',
  status           text not null default 'pending'
                   check (status in ('pending','running','completed','failed','dead','cancelled')),
  priority         int not null default 100,      -- lower = sooner
  run_at           timestamptz not null default now(),
  attempts         int not null default 0,
  max_attempts     int not null default 5,
  locked_by        text,
  lease_expires_at timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  finished_at      timestamptz
);
-- One live job per dedupe key (e.g. one debounced turn per conversation).
create unique index if not exists uq_jobs_dedupe_live
  on jobs (dedupe_key) where dedupe_key is not null and status in ('pending','running');
create index if not exists idx_jobs_ready on jobs (priority, run_at) where status = 'pending';
create index if not exists idx_jobs_leases on jobs (lease_expires_at) where status = 'running';
drop trigger if exists trg_jobs_updated on jobs;
create trigger trg_jobs_updated before update on jobs
  for each row execute function fn_set_updated_at();

-- 3. Transactional outbox -----------------------------------------------------
create table if not exists outbox_messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid references conversations(id) on delete cascade,
  message_id          uuid references messages(id) on delete set null,
  channel             text not null check (channel in ('messenger','instagram')),
  recipient_id        text not null,
  kind                text not null check (kind in ('text','image')),
  body                text,
  image_url           text,
  product_id          uuid references products(id) on delete set null,
  idempotency_key     text not null unique,
  status              text not null default 'pending'
                      check (status in ('pending','sending','sent','failed','uncertain','dead','cancelled')),
  provider_message_id text,
  attempts            int not null default 0,
  max_attempts        int not null default 4,
  next_attempt_at     timestamptz not null default now(),
  last_error          text,
  sender_type         text not null default 'ai' check (sender_type in ('ai','human','system')),
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create index if not exists idx_outbox_pending
  on outbox_messages (next_attempt_at) where status in ('pending','uncertain');
create index if not exists idx_outbox_conversation on outbox_messages (conversation_id, created_at desc);

-- 4. Conversation invariants --------------------------------------------------
-- Close duplicate active conversations per customer, KEEPING the most recent
-- (messages are preserved on the closed rows).
with active as (
  select id,
         row_number() over (
           partition by customer_id
           order by coalesce(last_message_at, created_at) desc, created_at desc
         ) as rn
  from conversations
  where customer_id is not null
    and status not in ('resolved','completed','cancelled','spam','blocked')
)
update conversations c
   set status = 'resolved'
  from active a
 where c.id = a.id and a.rn > 1;

create unique index if not exists uq_conversations_one_active_per_customer
  on conversations (customer_id)
  where customer_id is not null
    and status not in ('resolved','completed','cancelled','spam','blocked');

-- Human-attention flag decoupled from AI pause: the AI can keep answering
-- product questions while the team follows up on an order/complaint, until an
-- admin explicitly presses Take Over (ai_enabled=false).
alter table conversations add column if not exists human_attention boolean not null default false;
alter table conversations add column if not exists human_attention_reason text;
alter table conversations add column if not exists human_attention_at timestamptz;
-- Anti-loop: when the single order-handoff message was last sent.
alter table conversations add column if not exists handoff_sent_at timestamptz;
alter table conversations add column if not exists takeover_admin_id uuid references admin_accounts(id) on delete set null;
create index if not exists idx_conversations_attention
  on conversations (human_attention, last_message_at desc) where human_attention;

-- Migrate legacy needs_human status into the new flag (status enum stays valid).
update conversations
   set human_attention = true,
       human_attention_reason = coalesce(human_attention_reason, detected_intent),
       human_attention_at = coalesce(human_attention_at, updated_at)
 where status = 'needs_human' and not human_attention;

-- 5. Truthful message delivery status -----------------------------------------
alter table messages add column if not exists delivery_status text
  check (delivery_status in ('pending','sent','partial','failed','uncertain','skipped'));
-- Backfill legacy outbound rows from what was recorded at the time.
update messages
   set delivery_status = case
     when delivered_at is not null then 'sent'
     when is_internal_suggestion then 'skipped'
     else 'failed'
   end
 where direction = 'outbound' and delivery_status is null;
