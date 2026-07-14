-- 0013 — self-hosted cleanup (Supabase → owned Postgres).
--
-- The app now connects directly as the database owner; there is no PostgREST,
-- no anon role traffic, and no Supabase Auth. Row-level security and the
-- Supabase-era policies are therefore inert theater — drop them so the schema
-- honestly reflects the trust model (the app's middleware is the gate).
-- Idempotent; safe to re-run.
--
-- Fresh-database bootstrap: run this file FIRST (before schema.sql). schema.sql
-- predates the migration off Supabase and declares admin_users with a foreign
-- key to auth.users; the shim below gives it the minimal shape it expects. The
-- FK is detached at the end of this file, so the shim carries no runtime role.

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);

do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('alter table public.%I disable row level security', r.relname);
  end loop;
end $$;

-- admin_users referenced Supabase's auth.users; the single admin now lives in
-- env config. Keep the table for audit history but detach the FK.
alter table if exists admin_users drop constraint if exists admin_users_id_fkey;
