-- 0014 — Central AI Control sections and campaign-specific creative variables.
-- Forward-only and data-preserving: legacy prompt columns remain available for
-- historical records, but new runtime code no longer treats them as behavior.

begin;

insert into ai_behaviors (behavior_key, title, prompt, rules, memory)
values
  ('brand_identity', 'Brand Identity',
   'You represent English Home Libya. Sound warm, refined, trustworthy and human. Preserve a premium but attainable home-lifestyle character without sounding scripted or exaggerated.',
   null, null),
  ('human_handoff', 'Human Handoff',
   'When a teammate must take over, acknowledge the customer naturally, explain that the team will follow up, and ask only for information genuinely needed for that follow-up. Never sound like an automated escalation notice.',
   null, null),
  ('memory_summary', 'Memory and Conversation Summary',
   'Write a compact factual memory for future customer-service turns. Keep only useful needs, preferences, products discussed, and contact details explicitly supplied by the customer. Use one or two short sentences.',
   null, null),
  ('product_preservation', 'Product Preservation',
   'Generate the scene around the supplied product rather than redesigning it. Preserve the product''s exact shape, colors, patterns, materials, proportions, stitching, handles, labels, visible construction details and included pieces. Do not add variants, accessories, duplicates or product features that are not visible in the source image.',
   null, null),
  ('image_typography', 'Typography and Text on Images',
   'When exact image text is requested, render that text clearly with professional Arabic typography, correct directionality, clean hierarchy, generous spacing and placement that does not cover the product. Do not add any other text, price, discount, promotion or logo.',
   null, null),
  ('advanced_task_instructions', 'Advanced Task Instructions', null, null, null)
on conflict (behavior_key) do nothing;

alter table campaigns add column if not exists objective text;
alter table campaigns add column if not exists image_text text;
alter table campaigns add column if not exists aspect_ratio text not null default '1:1';
alter table campaigns add column if not exists target_channel text not null default 'facebook_instagram';

alter table campaign_assets add column if not exists prompt_trace_id text;
alter table campaign_assets add column if not exists requested_overlay_text text;
alter table campaign_assets add column if not exists overlay_text_status text;
alter table campaign_assets add column if not exists product_fidelity_status text;
alter table campaign_assets add column if not exists verification jsonb not null default '{}'::jsonb;
alter table campaign_assets add column if not exists requested_model text;
alter table campaign_assets add column if not exists actual_model text;
alter table campaign_assets add column if not exists fallback_used boolean not null default false;

commit;
