-- Run FIRST on a fresh self-hosted Postgres, before schema.sql.
--
-- schema.sql was written for Supabase, where an `auth.users` table and the
-- `authenticated`/`anon`/`service_role` roles exist out of the box. This shim
-- provides them so the schema applies unchanged; migration
-- 0013_self_hosted.sql then removes the Supabase-era policies that used them.
-- Auth itself lives in the app (env credentials + signed session cookie).

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

do $$ begin
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
