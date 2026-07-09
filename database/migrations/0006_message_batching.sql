-- 0006_message_batching.sql
-- Adds the per-conversation debounce deadline used to BATCH a burst of customer
-- messages into a single AI turn (see ENABLE_MESSAGE_BATCHING / MESSAGE_BATCH_WINDOW_MS).
--
-- When a customer message arrives and batching is on, the webhook stamps
-- next_turn_at = now() + window. A deferred drain runs the AI turn only when the
-- deadline is reached AND has not been pushed forward by a newer message, so the
-- whole burst (text + images + links) is answered as one turn.
--
-- Safe / additive: nullable column, no backfill, no behavior change until the
-- ENABLE_MESSAGE_BATCHING flag is turned on.

alter table public.conversations
  add column if not exists next_turn_at timestamptz;

-- Lets the drain efficiently find conversations whose batch window is due.
create index if not exists idx_conversations_next_turn_at
  on public.conversations (next_turn_at)
  where next_turn_at is not null;

insert into public.schema_migrations (version)
values ('0006_message_batching')
on conflict (version) do nothing;
