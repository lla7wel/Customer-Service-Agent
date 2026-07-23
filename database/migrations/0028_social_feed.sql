-- =============================================================================
-- 0028 — Social feed: normalized Meta posts + a unified comment/reply ledger
-- =============================================================================
-- Non-destructive storage for every Facebook/Instagram post the connected
-- accounts expose (app-published AND externally/manually published), plus the
-- sync checkpoints for a durable background backfill.
--
-- The existing content_comments table is EXTENDED (not replaced): it gains an
-- optional social_post_id so comments on external posts have a home, and a
-- reply ledger (source + responder + claim time + idempotency key) so a manual
-- and an automatic reply can never both answer the same comment. Existing rows
-- and reply history are preserved.
-- =============================================================================

create table if not exists social_posts (
  id                  uuid primary key default gen_random_uuid(),
  platform            text not null check (platform in ('facebook','instagram')),
  provider_post_id    text not null,
  account_id          text,                        -- page id or ig user id
  content_item_id     uuid references content_items(id) on delete set null,
  publication_id      uuid references content_publications(id) on delete set null,
  source              text not null default 'external' check (source in ('app','external')),
  post_type           text,                        -- photo/video/carousel/story/reel/status
  caption             text,
  media_type          text,                        -- image/video/carousel_album
  media_url           text,                        -- primary media
  media               jsonb not null default '[]', -- carousel children / extra media
  permalink           text,
  provider_created_at timestamptz,
  engagement          jsonb not null default '{}', -- likes/comments/reach where available
  comment_count       int not null default 0,
  provider_deleted    boolean not null default false,
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (platform, provider_post_id)
);
create index if not exists idx_social_posts_created on social_posts (provider_created_at desc nulls last);
create index if not exists idx_social_posts_platform on social_posts (platform, provider_created_at desc);
drop trigger if exists trg_social_posts_updated on social_posts;
create trigger trg_social_posts_updated before update on social_posts
  for each row execute function fn_set_updated_at();

-- Durable paging checkpoints for the background backfill + incremental sync.
create table if not exists social_sync_state (
  key           text primary key,   -- 'facebook:posts', 'instagram:media', ...
  cursor        text,               -- provider paging cursor (after)
  backfill_done boolean not null default false,
  last_run_at   timestamptz,
  last_error    text,
  updated_at    timestamptz not null default now()
);
drop trigger if exists trg_social_sync_state_updated on social_sync_state;
create trigger trg_social_sync_state_updated before update on social_sync_state
  for each row execute function fn_set_updated_at();

-- Extend content_comments for external posts + the shared reply ledger.
alter table content_comments add column if not exists social_post_id uuid references social_posts(id) on delete cascade;
alter table content_comments alter column publication_id drop not null;
alter table content_comments add column if not exists reply_source text check (reply_source in ('auto','manual'));
alter table content_comments add column if not exists reply_by_admin_id uuid references admin_accounts(id) on delete set null;
alter table content_comments add column if not exists reply_claimed_at timestamptz;   -- atomic claim: first claimer answers
alter table content_comments add column if not exists reply_idempotency_key text;

-- Comments on external posts dedupe by (social_post_id, provider_comment_id).
create unique index if not exists uq_content_comments_social
  on content_comments (social_post_id, provider_comment_id)
  where social_post_id is not null;
create index if not exists idx_content_comments_social_post
  on content_comments (social_post_id, created_at desc);
