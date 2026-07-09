-- =============================================================================
-- Migration 0001 — initial schema
-- =============================================================================
-- For the FIRST deploy, running database/schema.sql is the source of truth and
-- is equivalent to this migration. This file exists so that subsequent changes
-- follow a numbered-migration workflow (0002_*.sql, 0003_*.sql, ...).
--
-- Apply order:
--   0001_init.sql   ->  \i ../schema.sql  (run the full schema)
--
-- To keep one source of truth we delegate to schema.sql rather than copy it.
-- With psql:   \i database/schema.sql
-- In Supabase: paste database/schema.sql into the SQL editor.
--
-- Future migrations should be self-contained ALTER statements that this project
-- applies in order. Record applied migrations in a `schema_migrations` table:

create table if not exists schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);

insert into schema_migrations (version)
values ('0001_init')
on conflict (version) do nothing;
