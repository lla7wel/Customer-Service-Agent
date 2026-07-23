-- =============================================================================
-- 0026 — Four-role RBAC (Owner / Analyzer / Poster / Messager)
-- =============================================================================
-- Replaces the two-tier `role in ('owner','admin')` + `full_access` boolean
-- authorization model with four explicit roles. `full_access` is NOT dropped —
-- it is kept only so a rollback and any legacy read remain safe — but it is no
-- longer consulted for authorization anywhere in the application.
--
-- Preserve existing access on migration:
--   * existing owners stay Owner;
--   * legacy non-owner ('admin') accounts with full_access = true  → Owner;
--   * legacy non-owner ('admin') accounts with full_access = false → Messager.
-- The Owner can then re-assign Analyzer / Poster / Messager in Settings.
--
-- Idempotent and forward-only: the data migration only touches legacy 'admin'
-- rows, so a second run (after roles are re-assigned) is a no-op.
-- =============================================================================

-- 1. Drop whatever CHECK constraint currently guards admin_accounts.role,
--    regardless of its auto-generated name (and the new one, on a re-run).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.admin_accounts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table admin_accounts drop constraint %I', c.conname);
  end loop;
end $$;

-- 2. Migrate legacy 'admin' rows to the new roles (owners untouched).
update admin_accounts set role = 'owner'    where role = 'admin' and full_access = true;
update admin_accounts set role = 'messager' where role = 'admin' and full_access = false;

-- 3. Least-privilege default for any future insert that omits a role.
alter table admin_accounts alter column role set default 'messager';

-- 4. Re-add the CHECK constraint with the four valid roles.
alter table admin_accounts
  add constraint admin_accounts_role_check
  check (role in ('owner', 'analyzer', 'poster', 'messager'));
