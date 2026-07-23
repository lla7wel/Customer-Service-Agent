-- =============================================================================
-- 0027 — Encrypted provider connections (Meta) + OAuth CSRF state
-- =============================================================================
-- Forward-only, encrypted-at-rest storage for the Meta connection so the owner
-- can connect/reconnect from the UI without touching the server environment.
--
-- Secrets (page access token, app secret, verify token, long-lived user token)
-- are stored ONLY as AES-256-GCM ciphertext (integrations/providers/
-- secret-crypto.ts) using the deployment key INTEGRATION_ENCRYPTION_KEY. The
-- database never holds a plaintext secret; the UI only ever sees masked tails.
--
-- A one-time import copies valid META_* environment values into encrypted
-- storage; afterwards the database is the authoritative runtime source for both
-- the app and the worker. Environment values remain a fallback during migration.
-- =============================================================================

create table if not exists provider_connections (
  id                     int primary key default 1 check (id = 1),  -- singleton Meta connection
  provider               text not null default 'meta',

  -- Encrypted secrets — ciphertext only, never plaintext.
  page_access_token_enc  text,
  app_secret_enc         text,
  verify_token_enc       text,
  user_access_token_enc  text,

  -- Safe, non-secret metadata.
  app_id                 text,
  page_id                text,
  page_name              text,
  ig_user_id             text,
  ig_username            text,
  granted_scopes         text[] not null default '{}',
  token_expires_at       timestamptz,
  page_token_tail        text,          -- masked ending for display only

  -- Subscription state, verified by reading the edges back from Meta.
  page_subscribed_fields text[] not null default '{}',
  ig_subscribed_fields   text[] not null default '{}',

  -- Freshness / provenance.
  source                 text not null default 'env' check (source in ('env','oauth','manual')),
  status                 text not null default 'disconnected',
  connected_at           timestamptz,
  last_verified_at       timestamptz,
  last_webhook_at        timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
drop trigger if exists trg_provider_connections_updated on provider_connections;
create trigger trg_provider_connections_updated before update on provider_connections
  for each row execute function fn_set_updated_at();

-- Short-lived, single-use CSRF state for the Facebook OAuth handshake, bound to
-- the admin session that started it.
create table if not exists provider_oauth_states (
  state        text primary key,
  admin_id     uuid references admin_accounts(id) on delete cascade,
  redirect_uri text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz
);
create index if not exists idx_provider_oauth_states_expiry on provider_oauth_states (expires_at);
