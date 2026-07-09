# EH-SYSTEM1 — Pipeline Map

Data-flow documentation for the four runtime pipelines. No business logic lives
here — for the actual code see the files listed under each section.

---

## 1. Messenger pipeline

**Triggered by:** `POST /api/meta/webhook` (the only production webhook).

```
Inbound Messenger event
       │
       ▼
[meta/index.ts]
  parseMessengerWebhook()        — normalize raw webhook body → MessengerEvent[]
  verifyWebhookSignature()       — HMAC-SHA256 check (blocks forged requests)
       │
       ▼
[pipelines/messenger.ts]
  processMessengerEvents()
    ├─ ingestInbound()           — upsert customer, open/find conversation,
    │                              dedupe by Messenger mid, insert message row
    │
    ├─ if BATCHING ON:
    │    stamp debounce deadline, return pendingConversationIds
    │    caller awaits runMessageBatchDebounce()
    │      └─ sleep(batchWindowMs) then for each conversation:
    │           if still the latest inbound → runConversationTurn()
    │
    └─ if BATCHING OFF (legacy):
         runConversationTurn() immediately per event
              │
              ▼
         runConversationTurn()  (returns early if ai_enabled=false — admin paused)
           1. Load conversation + customer PSID from DB
           2. Gather unanswered batch (inbound messages since last outbound)
           3. [tools/memory] getCustomerMemory() + buildMemoryContext()
           4. findRecentUnansweredImage() — look back for unanswered image
              OR loadLastImageContext() for "same one / بكم؟ / نبيها"
           5. [agent-policy.ts] decideAgentAction() → 'image_turn' | 'text_turn'
              (no legacy escalation records)
           6. handleImageTurn() OR handleImageFollowUpTurn() OR handleTextTurn()
              — admin-required turns send a handoff message, then mark
                needs_human + ai_enabled=false
           7. updateMemoryAfterTurn() — recent products, contact facts, summary
                │                         │
                ▼                         ▼
          [pipelines/image-match.ts]   [pipelines/product-resolve.ts]
          matchCustomerImage()          resolveProductsFromText()
                │                         │
                └─────────┬───────────────┘
                           ▼
                    deliverAndStore()
                      ├─ sanitizeCustomerTextDetailed()  (strips leaked system text)
                      ├─ re-read ai_enabled (handoff race guard)
                      ├─ [meta/index.ts] sendMessage()   (when Meta configured + AI still on)
                      └─ insert outbound message row + ai_meta diagnostics
```

**Key flags** (all in `integrations/flags.ts`):
| Flag | Default | Effect |
|------|---------|--------|
| `ENABLE_MESSAGE_BATCHING` | `true` | Merges burst into one AI turn |
| `MESSAGE_BATCH_WINDOW_MS` | `8000` | Debounce window in milliseconds |

---

## 2. Image-match pipeline

Shared by the live Messenger pipeline AND the AI Playground. Both call
`matchCustomerImage()` from `integrations/pipelines/image-match.ts`.

```
matchCustomerImage(db, opts)
  │
  ├─ 1. Exact product_images.public_url lookup
  │      → immediate 'exact' return if our own catalog image URL
  │
  ├─ 2. Download image bytes (fetchImageBase64Detailed)
  │      + compute dHash perceptual fingerprint
  │
  ├─ 2c. Correction memory: scan image_match_corrections for a near-identical
  │       customer hash that an admin previously linked to a product
  │       → immediate 'exact' return if dist ≤ SIMILAR_MAX
  │
  ├─ 2d. Near-duplicate scan: compare customer hash against all product image
  │       hashes in product_images (up to 8,000 rows)
  │       → immediate 'exact' return if dist ≤ NEAR_DUPLICATE_MAX
  │
  ├─ 3. [gemini/index.ts] describeProductImage()
  │       → keywords_en, keywords_ar, product_type, color, material,
  │         code_text, barcode_text
  │
  ├─ 4. Exact product_code / barcode lookup from visible text in the image
  │
  ├─ 5. searchCatalog() — wide keyword search over active+priced products
  │       + union in fingerprint-similar products the keyword search missed
  │
  ├─ 6. [gemini/index.ts] matchProductFromImage()
  │       — Gemini ranks the candidate pool against the image (semantic)
  │
  ├─ 7. Multi-signal combine: 0.55×Gemini + 0.45×pHash similarity
  │
  └─ 8. Fallback visual re-rank (only when no fingerprint signal):
         [gemini/index.ts] rankProductsByImage()
         → downloads candidate product images, asks Gemini to compare photos

Returns: { outcome, candidates[], exactProductId, customerImageHash, diagnostics }
```

**Hard safety (never relaxed):** only `status = active` AND `active_price IS NOT NULL`
products are ever surfaced. Turkish `source_name` is never customer-facing.

---

## 3. Controlled tools + vector search

Both the text and image turns retrieve through `integrations/tools/`. Gemini may
also call the read tools directly via function calling (`chatReplyWithTools`).

```
findProductByCode / findProductByBarcode / findProductByUrl   — deterministic identity
searchProductsByText                                          — keyword (AR/EN/TR)
vectorSearchProductText                                       — real semantic embeddings
getProductPrice / getProductOptions                           — price + same-family options
getCustomerMemory / updateCustomerMemory                      — per-customer memory (pipeline only)
saveImageCorrection                                           — correction → fingerprint learning
```

Embeddings: `embedText()` (real Gemini model) → `products.text_embedding` (JSON,
cosine in code; no pgvector). Returns `[]` when unavailable — never fake vectors.
See [AI_BRAIN.md](AI_BRAIN.md).

> The Facebook **comments** pipeline was removed in the AI rebuild.

---

## 4. Campaign pipeline

**Triggered by:** Admin UI → API routes OR cron scheduler.

```
Admin creates/edits campaign
       │
       ▼
[api/campaigns/route.ts + [campaignId]/route.ts]
  → CRUD on campaigns table
  → [pipelines/campaign.ts] prepareCampaignPosts() — create facebook_posts drafts
  → [pipelines/campaign.ts] publishPost()          — push to Meta Graph API
  → [pipelines/campaign.ts] refreshPricing()       — call fn_refresh_product_pricing()

Cron / scheduler tick
       │
       ▼
[api/cron/campaign-scheduler/route.ts]   OR   [workers/campaign-scheduler/src/index.ts]
  → [pipelines/campaign.ts] runSchedulerTick()
       ├─ refreshPricing()                 — update cached active_price on products
       └─ auto-publish due campaigns       — publishPost() for each due scheduled post
```

**AI in campaigns:**
- Caption generation: `admin-app/src/app/api/ai/playground/route.ts` → `gemini/index.ts caption()`
- Design prompt: `gemini/index.ts designPrompt()`
- Image edit/generate: `gemini/index.ts editImage()`

---

## 5. Text product resolve pipeline

Used by the messenger text-turn handler when the customer's message contains a
product question or a URL (e.g. an English Home Turkey link pasted into chat).

```
resolveProductsFromText(db, text, limit)   [pipelines/product-resolve.ts]
  │
  ├─ parseProductUrl()          — extract code/barcode/slug tokens from any URL
  ├─ exact product_code lookup  → single hit (outcome='exact')
  ├─ exact barcode lookup       → single hit (outcome='exact')
  ├─ retrievePool()             — wide ilike search across all name fields + keywords
  └─ scoreRow()                 — in-code token overlap + code-family boost
       → ranked hits, outcome='multiple' or 'none'
```

---

## Shared utilities called across pipelines

| Utility | File | Used by |
|---------|------|---------|
| `sanitizeCustomerTextDetailed` | `util/customer-text.ts` | messenger, playground |
| `customerProductName` | `util/product-display.ts` | tools, image-match, product-resolve, messenger |
| `fetchImageBase64Detailed` | `util/base64.ts` | image-match |
| `dhashFromBytes` / `hammingHex` | `util/image-hash.ts` | image-match |
| `normalizeCode` / `normalizeBarcode` | `catalog-match.ts` | tools, image-match, product-resolve |
| `embedText` | `gemini/client.ts` | tools (vector search), embedding script |
| `composeBehaviorContext` | `ai-behaviors.ts` | messenger, playground |
| `loadBehaviorsWith` | `ai-behaviors.ts` | messenger, playground |
| `getCustomerMemory` / `buildMemoryContext` | `tools/memory.ts` | messenger, inbox, playground |
