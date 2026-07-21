-- =============================================================================
-- 0023 — One production prompt per operational AI task
-- =============================================================================
-- The 14 legacy behavior rows and their full version history remain untouched.
-- Their current effective text is copied once into task prompts so no owner
-- customization is lost. From this migration onward the compiler prefers the
-- consolidated task prompt, avoiding repeated and contradictory fragments.
-- =============================================================================

create table if not exists ai_task_prompts (
  task_key text primary key,
  title text not null,
  prompt text not null,
  enabled boolean not null default true,
  updated_by uuid references admin_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_ai_task_prompts_updated on ai_task_prompts;
create trigger trg_ai_task_prompts_updated before update on ai_task_prompts
  for each row execute function fn_set_updated_at();

create table if not exists ai_task_prompt_versions (
  id bigserial primary key,
  task_key text not null,
  title text not null,
  prompt text not null,
  enabled boolean not null,
  note text,
  saved_by uuid references admin_accounts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_task_prompt_versions_key on ai_task_prompt_versions(task_key, created_at desc);

create or replace function fn_consolidate_behaviors(keys text[]) returns text
language sql stable as $$
  select coalesce(string_agg(
    '## ' || title || E'\n' ||
    concat_ws(E'\n\n',
      case when nullif(trim(prompt),'') is not null then trim(prompt) end,
      case when nullif(trim(rules),'') is not null then trim(rules) end,
      case when nullif(trim(memory),'') is not null then trim(memory) end
    ), E'\n\n---\n\n' order by array_position(keys, behavior_key)
  ), '') from ai_behaviors where behavior_key = any(keys) and enabled = true;
$$;

insert into ai_task_prompts(task_key,title,prompt) values
('customer_reply','Customer Replies',fn_consolidate_behaviors(array['brand_identity','customer_service','reply_language','product_recommendation','missing_price','memory_context','advanced_task_instructions'])),
('product_recommendation','Product Search and Recommendations',fn_consolidate_behaviors(array['brand_identity','reply_language','product_recommendation','missing_price','memory_context','advanced_task_instructions'])),
('handoff_reply','Order Detection and Handoff',fn_consolidate_behaviors(array['brand_identity','customer_service','reply_language','human_handoff','memory_context','advanced_task_instructions'])),
('vision_describe','Image Matching — Analysis',fn_consolidate_behaviors(array['image_matching','advanced_task_instructions'])),
('vision_rank','Image Matching — Ranking',fn_consolidate_behaviors(array['image_matching','advanced_task_instructions'])),
('memory_summary','Memory',fn_consolidate_behaviors(array['memory_summary','advanced_task_instructions'])),
('campaign_caption','Marketing Copy',fn_consolidate_behaviors(array['brand_identity','campaign_caption','reply_language','advanced_task_instructions'])),
('campaign_image','Marketing Visuals',fn_consolidate_behaviors(array['campaign_image','product_preservation','image_typography','advanced_task_instructions'])),
('campaign_image_verify','Marketing Visual Verification',fn_consolidate_behaviors(array['product_preservation','image_typography','image_matching','advanced_task_instructions']))
on conflict(task_key) do nothing;

-- Locked owner decisions are appended once to the relevant consolidated tasks.
update ai_task_prompts set prompt = prompt || E'\n\n## English Home Libya locked operating decisions\n' ||
'Reply only in natural Libyan Arabic on Messenger and Instagram DM. Treat active products with a verified price as available. Never collect, confirm, or complete an order. At order intent, mention once that ordering is handled directly on WhatsApp: طرابلس 0923322008 (wh.ms/218923322008)، بنغازي 0924565511. Do not loop or spam this handoff. Continue answering normal product questions after handoff. Use concise family-level options, verified price ranges, relevant clarification, and real catalog images. Admin-locked catalog fields are authoritative.'
where task_key in ('customer_reply','product_recommendation','handoff_reply')
  and position('English Home Libya locked operating decisions' in prompt) = 0;

update ai_task_prompts set prompt = replace(replace(prompt,'campaign','content'), 'Campaign','Content')
where task_key in ('campaign_caption','campaign_image','campaign_image_verify');

drop function fn_consolidate_behaviors(text[]);
