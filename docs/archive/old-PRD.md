# EH-SYSTEM1 — Product Requirements (PRD)

> ⚠️ **Historical document.** This is the original product spec. Two features
> described below were **removed** in the AI rebuild and must not be reintroduced:
> the **Facebook comments** feature and the legacy **automatic escalation** workflow.
> Current handoff uses `needs_human` plus `ai_enabled=false` for admin-required
> conversations, and admins can also pause manually. For the current behavior see
> [AI_BRAIN.md](AI_BRAIN.md) and [ARCHITECTURE.md](ARCHITECTURE.md). Where this PRD
> conflicts with those, those win.

## 1. Purpose

A single admin/control center for **English Home Libya** that runs customer
service, orders, the product database, image recognition, Facebook comments, and
marketing automation. It is operated by **one admin** in v0.

The north-star KPI: **fewer human escalations** (the AI handles more end-to-end).

## 2. Scope boundaries

- **In scope:** the admin app, the Supabase data model, the Gemini AI provider
  layer, the Meta (Messenger + comments + posting) integration, and import
  scripts that read the existing scraper's output.
- **Out of scope / explicit non-goals:**
  - The system **never** places orders on the English Home **Turkey** website.
    Libya ordering is an internal **draft** workflow.
  - The system **never** runs or edits the scraper (`../english-home-tr-scraper`).
    It only **reads** the scraper's output files.
  - No fake/mock business data shipped as the product. Missing integrations show
    **"Not connected / setup required"** states.

## 3. Users & roles

v0 has a single `admin` role that can: view conversations, send human messages,
pause/resume AI, create orders, edit products, launch campaigns, publish to
Facebook, change AI rules/prompts, and view logs. The schema (`admin_role`
enum + RLS) is structured so more roles can be added later without migration.

## 4. Language requirements

- **Customer-facing AI:** always replies in **Libyan Arabic**, even when the
  customer writes English/Turkish/standard Arabic. It understands all of them.
- **Admin UI:** bilingual (Arabic + English) with a language switch and **real
  RTL** layout for Arabic.

## 5. Modules (15)

1. **Dashboard** — operational KPIs + integration status.
2. **Customer inbox** — list with customer, channel, status, escalation reason,
   detected intent, cart/order draft, last human response, time since last reply,
   context.
3. **AI conversation monitor** — per-conversation operational AI info (intent,
   status, escalation reason, product/order context, suggested next action). No
   hidden chain-of-thought is shown.
4. **Human escalation control** — view escalation reason, take over, message.
5. **Orders** — internal order drafts.
6. **Products** — fully editable product DB.
7. **Product images** — gallery + primary image + storage status.
8. **Image recognition** — review customer images, AI matches, corrections.
9. **Marketing campaigns** — builder (products, discount, dates, prompts,
   schedule, comment rules).
10. **Facebook posts** — image/carousel, scheduled/auto publish.
11. **Facebook comments** — AI public replies.
12. **AI control panel** — system prompt + rules; live immediately.
13. **Analytics** — conversations, escalations, orders, matches, campaigns,
    comments, AI errors, response time.
14. **Logs/activity feed** — human messages, order edits, product matches,
    campaign generation, FB posts, FB comment replies.
15. **Settings** — integrations, language, account.

## 6. Conversation lifecycle (statuses)

`new → ai_handling → needs_human → human_active → waiting_for_customer →
order_draft → waiting_for_order_confirmation → order_confirmed →
pickup_requested | delivery_requested → completed | cancelled | resolved`,
plus `spam`, `blocked`, `waiting_for_customer_info`, `issue_refund_exchange`.
(Stored as the `conversation_status` enum.)

## 7. Escalation behavior

The LLM **classifies** escalation (no fixed templates). Triggers: human
requested, product not found, order confirmation, complaint/refund/exchange,
abuse, failed image match. The UI shows the **reason** and lets the admin send a
human message. Taking over sets `conversations.ai_enabled = false`; the AI
pauses but may still generate **internal** suggestions (`messages.is_internal_suggestion`).

## 8. Image recognition flow

- **Exact match** → return the matched product automatically (no approval).
- **Multiple matches** → reply in Arabic with options **1–5** and images.
- **No match** → escalate.
- **Image + text** → treat as one context chunk.
- **Several images** → match each separately.
- The image-review page shows: customer image, AI top matches, "reject all",
  manual product search, and **save correction** (stored in
  `image_match_corrections`) which improves future matching immediately.

## 9. Ordering workflow

Order **drafts** only. Required info: customer name, address, product (if not
chosen), quantity, delivery/pickup method. Statuses:
`waiting_for_customer_info → waiting_for_order_confirmation → completed |
cancelled | issue_refund_exchange`. The AI can collect info and create/update the
draft automatically. Confirmation buttons gate only: **confirm order**, **cancel
order**, **publish campaign**.

## 10. Pricing rule

Campaign discounts override regular prices:

```
active_price = campaign_price  if the product is in a currently-active campaign
             = base_price      otherwise
campaign_price = override_price (if set) else base_price * (1 - discount%/100)
```

The campaign price is used everywhere: captions, comments, Messenger replies,
order drafts, product display. **Overlap rule:** highest campaign `priority`
wins; ties break on the latest `starts_at` (i.e. "latest active campaign wins"
unless the admin sets priority). Implemented in `product_active_pricing` view +
`fn_active_price()`; cached on `products` and refreshed by the campaign
scheduler. (See [ARCHITECTURE.md](ARCHITECTURE.md#pricing).)

## 11. Marketing campaigns

Builder fields: name, products/images, discount %, start/end, caption tone,
design prompt, caption prompt, publish-now/schedule, comment-reply rules.
Capabilities: upload images, select one/many products, one discount for all, use
original images, AI image edits, AI Arabic/Libyan captions, scheduling,
auto-publish once configured. Types: single-product discount, multi-product
carousel, category sale, flash sale, clearance, seasonal (Ramadan/Eid).
Output: edited image(s) + caption + Facebook post.

Visual direction: clean/professional like English Home, fully Arabic. No
hardcoded logo rule; theme is promptable. AI decides on-image text unless the
admin specifies it.

## 12. Facebook

- **Messenger** webhook for DMs.
- **Comments** webhook; AI replies publicly (price, availability, delivery,
  pickup/branch, "how much?", complaints, angry comments). No approval in v0.
- **Posting**: image + carousel, auto-publish (after setup) + scheduled.

## 13. AI control & playground

`/ai-control`: edit system prompt, product recommendation rules, escalation
rules, caption tone — changes are live immediately. `/ai-playground`: type a fake
message, upload an image, test product matching, preview Gemini reply / campaign
caption / comment reply. The playground **never** sends to customers unless
explicitly clicked.

## 14. Integrations & "not connected" contract

Every integration is feature-detected from env. If a credential is missing the
UI shows **Not connected / Missing env var / Setup required** with a link to
setup docs. Server endpoints return `503` with `{ error: 'integration_not_configured' }`.

## 15. Acceptance — "first successful demo"

- App opens; `/dashboard` works.
- Supabase connection is ready (schema runnable; status visible).
- Product import flow exists for scraper output (`scripts/`).
- Inbox UI exists for Messenger/Facebook conversations.
- Order draft UI exists.
- Campaign builder exists.
- AI control/playground exists.
- Everything is integration-ready: plug in credentials, scraper output,
  Supabase, Gemini, Meta.

## 16. Roadmap (post-demo)

- Live outbound message send (Messenger Send API) + delivery receipts.
- Per-role RLS policies (staff vs admin).
- Campaign auto-publish via the Cloudflare cron worker + scheduled FB posts.
- Image-match feedback loop: use `image_match_corrections` to re-rank matches.
- Embedding-based image search (replace the v0 hash/keyword approach).
- Analytics rollups (materialized views) for response-time + escalation trends.
