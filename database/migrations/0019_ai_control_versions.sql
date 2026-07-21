-- =============================================================================
-- 0019 — AI Control version history + operational AI event hygiene
-- =============================================================================
-- Every save of an editable AI behavior is versioned so the owner can see a
-- diff and restore any earlier version with one click — no deployment needed.
-- Current state stays in ai_behaviors (live reads unchanged); history rows are
-- append-only.
--
-- Idempotent and forward-only.
-- =============================================================================

create table if not exists ai_behavior_versions (
  id            bigint generated always as identity primary key,
  behavior_key  text not null,
  title         text,
  prompt        text,
  rules         text,
  memory        text,
  enabled       boolean not null default true,
  saved_by      uuid references admin_accounts(id) on delete set null,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_ai_behavior_versions_key
  on ai_behavior_versions (behavior_key, created_at desc);

-- Snapshot the current live behaviors as version 1 of each key.
insert into ai_behavior_versions (behavior_key, title, prompt, rules, memory, enabled, note)
select b.behavior_key, b.title, b.prompt, b.rules, b.memory, b.enabled, 'baseline snapshot (migration 0019)'
  from ai_behaviors b
 where not exists (select 1 from ai_behavior_versions v where v.behavior_key = b.behavior_key);

-- Honest AI telemetry (EH-023): allow recording real failures/latency.
alter table ai_events add column if not exists trace_id text;
alter table ai_events add column if not exists task text;
