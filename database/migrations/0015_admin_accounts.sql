-- =============================================================================
-- 0015 — Multi-admin accounts, database-backed sessions, audit, login limits
-- =============================================================================
-- Replaces the single env-credential admin (ADMIN_EMAIL/ADMIN_PASSWORD_HASH)
-- with real admin accounts:
--   * the first OWNER is bootstrapped from OWNER_USERNAME/OWNER_PASSWORD_HASH
--     env vars (scripts/bootstrap-owner.ts) — no default password anywhere;
--   * the owner creates the other admins directly with username + password;
--   * sessions are stored server-side (token hash only) so they can be revoked;
--   * every login attempt is recorded for rate limiting;
--   * every meaningful admin action lands in admin_audit_log.
--
-- The legacy admin_users table (Supabase-era) is kept untouched for historical
-- FK references from old rows; new code reads/writes admin_accounts only.
--
-- Idempotent and forward-only.
-- =============================================================================

create table if not exists admin_accounts (
  id             uuid primary key default gen_random_uuid(),
  username       text not null,
  display_name   text,
  password_hash  text not null,             -- bcrypt
  role           text not null default 'admin' check (role in ('owner', 'admin')),
  -- "Full access" makes another admin practically equal to the owner
  -- (everything except deleting/demoting the owner).
  full_access    boolean not null default true,
  is_active      boolean not null default true,
  preferred_locale text not null default 'ar',
  created_by     uuid references admin_accounts(id) on delete set null,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists uq_admin_accounts_username on admin_accounts (lower(username));
drop trigger if exists trg_admin_accounts_updated on admin_accounts;
create trigger trg_admin_accounts_updated before update on admin_accounts
  for each row execute function fn_set_updated_at();

create table if not exists admin_sessions (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references admin_accounts(id) on delete cascade,
  token_hash   text not null unique,        -- sha256 of the session token
  ip           text,
  user_agent   text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index if not exists idx_admin_sessions_admin on admin_sessions (admin_id);
create index if not exists idx_admin_sessions_expiry on admin_sessions (expires_at);

create table if not exists admin_audit_log (
  id             bigint generated always as identity primary key,
  admin_id       uuid references admin_accounts(id) on delete set null,
  admin_username text,                       -- denormalized: survives account deletion
  action         text not null,              -- 'login', 'product.update', 'price.change', ...
  entity_type    text,
  entity_id      text,
  detail         jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
create index if not exists idx_admin_audit_created on admin_audit_log (created_at desc);
create index if not exists idx_admin_audit_entity on admin_audit_log (entity_type, entity_id);

create table if not exists login_attempts (
  id          bigint generated always as identity primary key,
  username    text,
  ip          text,
  ok          boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_login_attempts_ip on login_attempts (ip, created_at desc);
create index if not exists idx_login_attempts_user on login_attempts (username, created_at desc);
