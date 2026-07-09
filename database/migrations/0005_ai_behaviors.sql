-- =============================================================================
-- 0005 — AI behaviors (per-behavior prompt / rules / memory)
-- =============================================================================
-- ai_settings was a single flat row, which could not express the distinct AI
-- behaviors the admin needs to control independently (customer service, image
-- matching, escalation, Facebook comments, campaign caption, campaign image,
-- product recommendation, reply language, missing-price handling, memory).
--
-- This table holds one editable row per behavior. ai_settings is kept for model
-- overrides + temperature + a master system_prompt; ai_behaviors carries the
-- per-behavior content. Each Gemini call loads its behavior (prompt + rules +
-- memory) so admin edits take effect immediately. Supabase stays the truth; AI
-- never invents prices and never overwrites admin-locked catalog fields.
--
-- Additive + idempotent. Seeds from the active ai_settings row where relevant.
-- =============================================================================

create table if not exists ai_behaviors (
  id            uuid primary key default gen_random_uuid(),
  behavior_key  text unique not null,
  title         text not null,
  prompt        text,            -- the behavior instruction
  rules         text,            -- extra constraints
  memory        text,            -- persistent context/notes for this behavior
  enabled       boolean not null default true,
  updated_by    uuid references admin_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
drop trigger if exists trg_ai_behaviors_updated on ai_behaviors;
create trigger trg_ai_behaviors_updated before update on ai_behaviors
  for each row execute function fn_set_updated_at();

-- Seed the standard behaviors (only those not already present).
insert into ai_behaviors (behavior_key, title, prompt, rules)
select v.behavior_key, v.title, v.prompt, v.rules
from (
  select 'customer_service' as behavior_key,
         'Customer service' as title,
         coalesce((select system_prompt from ai_settings where is_active limit 1),
           'You are the assistant for English Home Libya. Reply in Libyan Arabic, be warm, concise and practical. Use only the prices and product data provided to you. Never invent a price or product detail.') as prompt,
         null::text as rules
  union all select 'reply_language', 'Reply language & style',
         coalesce((select reply_language_rule from ai_settings where is_active limit 1),
           'Always reply to customers in Libyan Arabic, regardless of the language they wrote in.'),
         null
  union all select 'product_recommendation', 'Product recommendation',
         null,
         (select product_recommendation_rules from ai_settings where is_active limit 1)
  union all select 'escalation', 'Escalation',
         null,
         coalesce((select escalation_rules from ai_settings where is_active limit 1),
           'Escalate to a human for: explicit human request, product not found, order confirmation, complaint/refund/exchange, abuse, or a failed image match.')
  union all select 'facebook_comment', 'Facebook comment replies',
         null,
         (select comment_reply_rules from ai_settings where is_active limit 1)
  union all select 'campaign_caption', 'Campaign captions',
         null,
         coalesce((select campaign_caption_tone from ai_settings where is_active limit 1),
           'friendly, professional, Libyan Arabic')
  union all select 'campaign_image', 'Campaign image / design',
         'Create a clean, professional, on-brand promotional image for English Home Libya. Keep product shapes faithful; do not add fake text or prices.',
         null
  union all select 'image_matching', 'Product image matching',
         'When matching a customer photo to catalog products, prefer exact shape/color/material matches. If unsure, return multiple candidates rather than guessing one.',
         null
  union all select 'missing_price', 'Missing price / missing data',
         null,
         'If a product has no price or required data, do NOT invent it. Tell the customer you will check and escalate to a human.'
  union all select 'memory_context', 'Memory & context',
         null,
         'Shared facts the assistant should always remember (store, delivery areas, working hours, policies). Edit freely.'
) v
where not exists (select 1 from ai_behaviors b where b.behavior_key = v.behavior_key);
