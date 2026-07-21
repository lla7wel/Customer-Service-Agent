-- =============================================================================
-- 0020 — Provider readiness cache + owner analytics rollups
-- =============================================================================
-- provider_readiness: the truthful per-channel status shown in Settings.
-- Rows are written only by real capability checks against the providers —
-- never fabricated. A missing row means "not checked yet", shown as such.
--
-- analytics_daily: worker-computed daily rollups for the owner dashboard, built
-- exclusively from real local data (message counts, handoffs, publications).
-- Provider insights are stored only when the API actually returns them.
--
-- Idempotent and forward-only.
-- =============================================================================

create table if not exists provider_readiness (
  check_key   text primary key,        -- 'messenger','instagram_dm','facebook_page','instagram_publishing','gemini','webhooks','database','media'
  ok          boolean not null,
  summary     text,
  detail      jsonb not null default '{}',   -- redacted: never contains tokens
  checked_at  timestamptz not null default now()
);

create table if not exists analytics_daily (
  day          date not null,
  metric       text not null,
  value        numeric not null default 0,
  detail       jsonb not null default '{}',
  computed_at  timestamptz not null default now(),
  primary key (day, metric)
);
create index if not exists idx_analytics_daily_metric on analytics_daily (metric, day desc);
