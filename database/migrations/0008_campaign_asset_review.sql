-- 0008_campaign_asset_review.sql
-- Campaign image-edit review workflow (Priority 3): per-asset approval + linking
-- an AI-edited image back to its source asset (for one-click regenerate).
--
-- Additive/safe. `approved` defaults false so existing assets are unaffected;
-- prepareCampaignPosts() prefers approved assets when any exist, else falls back
-- to all (back-compat).

alter table public.campaign_assets
  add column if not exists approved boolean not null default false;

alter table public.campaign_assets
  add column if not exists source_asset_id uuid references public.campaign_assets(id) on delete set null;

create index if not exists idx_campaign_assets_approved
  on public.campaign_assets (campaign_id, approved);

insert into public.schema_migrations (version)
values ('0008_campaign_asset_review')
on conflict (version) do nothing;
