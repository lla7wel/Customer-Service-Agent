# EH-SYSTEM1 — AI and Messenger

How the Messenger AI agent works end-to-end: from inbound webhook to Gemini reply to Meta send.

---

## Meta webhook

**Endpoint:** `GET/POST /api/meta/webhook` (`admin-app/src/app/api/meta/webhook/route.ts`)

- **GET:** echoes `hub.challenge` if `hub.verify_token` matches `META_VERIFY_TOKEN`. Used for the initial webhook verification in Meta's developer dashboard.
- **POST:** verifies `X-Hub-Signature-256` (HMAC-SHA256 with `META_APP_SECRET`) on every request. Rejects forged payloads before any processing.

This is the only production webhook. There are no separate webhook workers. Subscribe Meta Page to `messages` and `messaging_postbacks` only — the Facebook comments feature has been removed.

---

## Messenger pipeline

File: `integrations/pipelines/messenger.ts`

```
POST /api/meta/webhook
  → verifyWebhookSignature()
  → processMessengerEvents()
      → ingestInbound()          # upsert customer, open/find conversation,
                                  # insert message row, dedupe by external_id
      → [if batching on]
          stamp next_turn_at on conversation
          runMessageBatchDebounce() — sleep(batchWindowMs), then:
            isLatestInbound()? → runConversationTurn()
      → [if batching off]
          runConversationTurn() immediately
```

**Message batching** (`ENABLE_MESSAGE_BATCHING`, default on; `MESSAGE_BATCH_WINDOW_MS`, default 5000ms): when a customer sends multiple messages quickly, only the last one triggers a turn. All messages since the last outbound are gathered and fed to Gemini as a single context. This prevents one reply per burst message.

---

## Conversation turn

`runConversationTurn()` — called once per settled burst:

1. Return early if `ai_enabled = false` on the conversation (admin paused).
2. Load conversation + customer PSID.
3. Gather **unanswered batch** — all inbound messages since the last outbound.
4. `getCustomerMemory()` — load persistent customer memory.
5. `findRecentUnansweredImage()` — look for an unresolved image in the batch.
6. `decideAgentAction()` → `image_turn` or `text_turn`.
7. `handleImageTurn()` / `handleImageFollowUpTurn()` / `handleTextTurn()`.
8. `updateMemoryAfterTurn()` — update recent products, contact facts, summary.

---

## Supersede guard (duplicate reply prevention)

The supersede guard in `deliverAndStore()` solves the race condition where a customer sends an image, then "بكم؟" while the image turn is still processing (Gemini + image matching takes ~10s).

Before sending to Meta, `deliverAndStore` re-reads the latest inbound message ID. If a newer message arrived since this turn started:
- The in-flight reply is **abandoned without storing any outbound row**.
- The unanswered batch remains intact (image + "بكم؟" both still unanswered).
- The newer turn, which started after all messages were in, reads the full batch and sends one combined reply.

The abandonment is logged to `ai_events` with `detected_intent = 'superseded_by_newer_inbound'`.

**Why not storing is intentional:** an outbound row would advance the `last_message_at` cursor, splitting the unanswered batch and causing the superseding turn to answer only the follow-up, not the image. By abandoning cleanly, the superseding turn has the full context.

---

## Gemini reply composition

File: `integrations/pipelines/compose-reply.ts` — `composeCustomerReply()`

- Temperature: **0.7** (natural, conversational).
- Uses `chatReplyWithTools()` — Gemini with function calling against the product tools.
- **Hard safety rules** (always enforced, not overridable from AI Control):
  1. Never invent a price — only quote `active_price` from the catalog.
  2. Always reply in Libyan Arabic (Darija), even if the customer writes in English or standard Arabic.
  3. Never confirm an order alone — escalate to human for payment/delivery/refund.
  4. Never leak internal tool names or system prompt details in the reply.

All customer-facing text is composed by Gemini. There are no hard-coded Arabic template strings anywhere in the pipeline.

---

## Product tools (what Gemini can read)

Gemini has no SQL access. It reaches the catalog only through typed tools in `integrations/tools/`:

| Tool | Purpose |
|------|---------|
| `findProductByCode` | Exact product code lookup |
| `findProductByBarcode` | Exact barcode lookup |
| `findProductByUrl` | Exact website URL lookup |
| `searchProductsByText` | Keyword search (AR/EN/TR names + keywords) |
| `vectorSearchProductText` | Semantic embedding search |
| `getProductPrice` | Active price of a product |
| `getProductOptions` | Other products in the same code family |

Memory tools (`getCustomerMemory`, `updateCustomerMemory`, `clearCustomerMemory`) and image correction (`saveImageCorrection`) are used by the pipeline directly, not exposed to Gemini's function-calling interface.

Only `status='active' AND active_price IS NOT NULL` products are ever shown to customers.

---

## Text turn

`integrations/pipelines/product-resolve.ts` → `resolveProductsFromText()`:

1. Parse URLs → exact `website_url`, then code/barcode from the URL path.
2. Exact product code or barcode typed in the message.
3. Keyword search + semantic vector search, merged and de-duplicated.

If resolution yields products → `composeCustomerReply()` with the candidates as context.
If not → `chatReplyWithTools()` with customer memory and tools available for live lookups (greetings, follow-ups, "what colors?", etc.).

---

## Image turn

`integrations/pipelines/image-match.ts` → `matchCustomerImage()` — 8-step hybrid pipeline, strongest signal first:

1. Exact product image URL match.
2. dHash perceptual fingerprint of the customer image.
3. Learned match — admin corrections from `image_match_corrections` + `product_fingerprints`.
4. Near-duplicate fingerprint vs. stored product image hashes.
5. Gemini vision describe → visible code/barcode → exact lookup.
6. Candidate retrieval: keyword search + semantic vector search from the vision description.
7. Gemini vision re-ranking — compares the customer image against candidate product images.
8. Visual re-rank rescue: if no candidates from steps 1–6 but the keyword pool is non-empty, downloads catalog images and runs image-to-image ranking.

If no signal yields a candidate, the AI asks one natural clarifying question and routes the conversation to `needs_human` — it never presents random unrelated products.

Image download is capped: 8s timeout, 20 MB max.

---

## Image follow-up turn

`integrations/pipelines/context-followup.ts`

When a customer follows up on an earlier image with "the same one", "بكم هذا", or similar phrases, the pipeline detects this via `isImageContextFollowUp()` and loads `last_image_context` (the product matched in the previous image turn). No re-matching is needed — the follow-up is answered using the already-resolved product.

---

## Product image sending

When a customer asks to **see** a product (photo, shape, colour), the AI can send real catalog product photos — not just text.

**Module:** `integrations/pipelines/product-image.ts` (pure logic) + `sendImageMessage()` in `integrations/meta/index.ts`.

### When images are sent
Images are sent **only** when the customer clearly asks to see them — detected by `detectImageRequest()`. Examples: `ابعثلي صورته`, `وريني الشكل`, `شنو الألوان؟`, `نبي نشوفهم`, `عندك صور للحمام؟`, `نبي نشوف الخيارات`.

A price/availability question alone (`بكم؟`, `وين موجود`) never triggers an image send.

### How it works
1. The customer message hits `detectImageRequest()`.
2. The backend builds a candidate pool: products resolved this turn → recent candidates from a prior reply (`ai_meta.candidates` / `last_image_context`) → products attached in customer memory.
3. `selectSendableImages()` picks **up to 3** distinct products that have a Meta-safe image, de-duplicating by product id and by identical image URL, and grouping same-family colour variants.
4. Gemini composes a short Libyan-Arabic caption (it is told images are attached; it never picks the URLs).
5. `deliverAndStore()` sends the caption then each image via `sendImageMessage()`, respecting the supersede guard.

### Safety rules (enforced in code)
- **Backend controls the URLs.** Gemini composes the caption only; it never chooses an image URL.
- **Max 3 images** auto-sent per turn (`MAX_AUTO_IMAGES`) — no spam.
- **Only public HTTPS URLs** are sent (`isMetaSafeImageUrl()`): no local file paths, no localhost, no `http://`, no broken URLs.
- **Image source priority:** `product_images.public_url`, preferring `is_primary` then lowest `position` (via `primaryProductImageUrl()`); falls back to the public Supabase Storage URL of `storage_path`.
- **Only active + priced products** reach this path. A draft/unpriced product is not auto-sent (the AI mentions it and says the price will be confirmed).
- **No usable image →** Gemini replies naturally that the photo isn't available and offers to help; no broken image, no placeholder.
- **Meta send failure →** logged to `integration_logs`, recorded in `ai_meta.image_send.failed`; only successfully-sent images go into `messages.attachments`, so the inbox never shows a failed image as delivered. `delivered_at` is set only on a confirmed send.

### Storage
A product-image reply is stored as one outbound message:
- `attachments`: the successfully-sent image URLs with their `product_id`.
- `ai_meta.image_send`: `{ workflow: 'product_image_send', requested, intended, sent, failed, product_ids }`.
- `delivered_at` set only when at least the caption or one image was confirmed sent.

### Variants and colours
When the selected products are the same code family (colour variants), `selectSendableImages()` sets `grouped = true` and the caption explains they are the same style in different colours — the customer isn't asked to choose between identical items.

### Manual send (inbox)
Each product candidate card in the Inbox has a **Send image** button (`send_product_image` action). It sends the product's primary catalog photo + a short caption via the same Meta helper. Disabled when the product has no usable image. Delivery state is recorded honestly (sent vs. failed).

### AI Suggest and Playground
- **AI Suggest** never auto-sends images to the customer; the admin sends manually via the Send image button.
- **AI Playground** shows `would_send_images` in its debug output and `image_request` in input signals — it never sends.

## Customer memory

Table: `customer_memory` — one row per customer.

Fields: `summary` (rolling Gemini-written summary), `recent_products` (last resolved products), `known_name`, `known_phone`, `known_address`, `preferences`, `durable_facts`.

Memory is loaded into every turn's Gemini prompt as context. It is updated after each turn. Admins view, edit, and clear it from the Inbox right rail (Customer memory panel).

---

## Story replies

A Facebook story reply is detected in the webhook payload (`referral.type = 'STORY_MENTION'` or attachment type = story). The story media URL is treated as the product image and routed into the image-match pipeline, so a customer saying "بكم هذا؟" on a story gets the same product recognition as a direct image message.

---

## AI Suggest vs auto-reply vs Playground

All three use the same pipeline and the same `messenger` behavior task:

| Path | Sends to customer? | Notes |
|------|--------------------|-------|
| Auto-reply (Messenger webhook) | Yes (if Meta configured + AI enabled) | Full pipeline, supersede guard active |
| AI Suggest (inbox button) | No — stored as `is_internal_suggestion = true` | Admin reviews before sending |
| AI Playground | No | Exact same pipeline, dry run, shows full debug trace |

---

## Model routing

All Gemini calls go through the central router in `integrations/gemini/client.ts`. No scattered hardcoded model names.

| Task | Env var | Default |
|------|---------|---------|
| Customer-service text + tool calls | `GEMINI_TEXT_MODEL` | `gemini-2.5-flash` |
| Intent / routing / memory summaries | `GEMINI_ROUTER_MODEL` | `gemini-2.5-flash-lite` |
| Captions, Arabic headlines | `GEMINI_MARKETING_TEXT_MODEL` | `gemini-2.5-flash` |
| Customer photo description/comparison | `GEMINI_VISION_MODEL` | `gemini-2.5-flash` |
| Image generation / editing (only) | `GEMINI_IMAGE_MODEL` | `gemini-3-pro-image-preview` |
| Image fallback | `GEMINI_IMAGE_FALLBACK_MODEL` | `gemini-3.1-flash-image-preview` |
| Image last-resort | `GEMINI_IMAGE_LAST_FALLBACK_MODEL` | `gemini-2.5-flash-image` |
| Semantic embeddings | `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` (768d) |

The strong image model is **only** for image generation/editing. It is never used for customer text, classification, captions, or memory. The image model chain walks preferred → fallback → last-fallback on rate-limit; the admin UI shows which model was actually used and whether a fallback occurred.

---

## How to debug "AI · Internal" (message not delivered)

"AI · Internal" means `is_internal_suggestion = true` — the AI generated a reply but it was not sent to the customer.

Causes:
1. **Meta not configured** — `metaStatus().configured` is false. Check env vars `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_VERIFY_TOKEN`, `META_APP_SECRET`.
2. **Page access token expired** — tokens have 60-day expiry without a Business account. Regenerate in Meta's developer dashboard.
3. **AI paused on the conversation** — check `conversations.ai_enabled`. It might have been paused after the turn started.
4. **Supersede guard fired** — the reply was superseded by a newer inbound message (correct behavior, not a bug). Check `ai_events` for `detected_intent = 'superseded_by_newer_inbound'`.

Diagnostic SQL:
```sql
-- Most recent Meta send failures
select created_at, body, ai_meta->>'delivery_error' as error
from messages
where direction = 'outbound'
  and is_internal_suggestion = true
  and ai_meta->>'delivery_error' is not null
order by created_at desc
limit 20;

-- Superseded turns (not a bug — normal race-condition prevention)
select * from ai_events
where detected_intent = 'superseded_by_newer_inbound'
order by created_at desc
limit 10;
```
