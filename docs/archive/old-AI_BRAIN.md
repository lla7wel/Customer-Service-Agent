# EH-SYSTEM1 — AI Product-Recognition Brain

How the AI actually works after the AI rebuild. The AI is a database-aware
commerce assistant, not a prompt box: it recognizes products from text, codes,
barcodes, links and images using the real catalog, remembers each customer, and
answers automatically in Libyan Arabic.

---

## Source of truth (never violated)

| Truth | Owner | Rule |
|-------|-------|------|
| Product identity, English/Libya name, price, code, barcode, stock | **Official Libya CSV/catalog** (`products`) | AI never invents these. |
| Customer-facing name | `customerProductName()` | `libyan_display_name` → `arabic_name` → Arabic fallback. **Never** Turkish `source_name`. |
| Price | `active_price` (campaign-adjusted in DB) | AI only ever reads it. Missing price → "the team will confirm". |
| Product images, Turkish names, URLs | Scraped data | Recognition signals only — never commercial truth. |

Only `status='active' AND active_price IS NOT NULL` products ever reach a customer.

---

## Model routing (one key, right model per task)

Every Gemini call routes through a **central router** in
`integrations/gemini/client.ts` — there are no scattered hardcoded model names.
Each task uses the cheapest model that does the job well, and the strong image
model is reserved for actual image work. Defaults are verified available on the
project `GEMINI_API_KEY` (Jun 2026).

| Task | Accessor | Env | Default |
|------|----------|-----|---------|
| Customer-service text, order wording, store/delivery info, tool replies | `textModel()` | `GEMINI_TEXT_MODEL` | `gemini-2.5-flash` |
| Intent / classification / routing / follow-up / memory summaries | `routerModel()` | `GEMINI_ROUTER_MODEL` | `gemini-2.5-flash-lite` |
| Captions, Arabic headlines, design briefs | `marketingTextModel()` | `GEMINI_MARKETING_TEXT_MODEL` | `gemini-2.5-flash` |
| Describe/compare customer product photos | `visionModel()` | `GEMINI_VISION_MODEL` | `gemini-2.5-flash` (pro vision = 90s+ on this key → unusable) |
| **Image generation / editing** (image work only) | `campaignImageModel()` + `imageModelChain()` | `GEMINI_IMAGE_MODEL` / `…_EDIT_MODEL` / `…_CAMPAIGN_IMAGE_MODEL` | `gemini-3-pro-image-preview` |
| Image fallback chain (logged + shown in admin) | `imageModelChain()` | `GEMINI_IMAGE_FALLBACK_MODEL`, `GEMINI_IMAGE_LAST_FALLBACK_MODEL` | `gemini-3.1-flash-image-preview` → `gemini-2.5-flash-image` |
| Embeddings only | `embeddingModel()` | `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` (768d) |

**Hard rules:**
- The image model is **never** used for normal text, classification, captions,
  memory summaries, or routine tool calls.
- Image generation walks the chain `preferred → fallback → last fallback`
  (`gemini-3-pro-image-preview` is occasionally rate-limited as "high demand").
  Fallback is **never silent**: it is logged (`console.warn`) and the actual
  model + a fallback warning are returned to the admin UI (`editImage()` →
  `model` / `requestedModel` / `fallbackUsed` / `attempts`).
- Captions/headlines are written by the **text** model; the image model is told
  **not** to render any text/Arabic/prices/logos/ornaments inside the image —
  it keeps clean negative space for an overlay added later.

---

## Controlled tools layer (`integrations/tools/`)

Gemini has **no SQL access**. It reaches the catalog only through typed tools,
which enforce the safety rules above in one place:

| Tool | Purpose | Exposed to Gemini? |
|------|---------|--------------------|
| `findProductByCode` | exact product code | yes (function calling) |
| `findProductByBarcode` | exact barcode | yes |
| `findProductByUrl` | exact `website_url`, then slug | yes |
| `searchProductsByText` | keyword search (AR/EN/TR + keywords) | yes |
| `vectorSearchProductText` | semantic embedding search | yes |
| `getProductPrice` | active price of a product | yes |
| `getProductOptions` | other options in the same code family | yes |
| `getCustomerMemory` | read a customer's memory | pipeline only |
| `updateCustomerMemory` | write memory | pipeline only |
| `clearCustomerMemory` | wipe memory | pipeline only |
| `saveImageCorrection` | store correction + fingerprint (learning) | pipeline only |

The pipeline retrieves the strongest candidates first, then hands a small set to
Gemini — never thousands of products.

---

## Text / code / barcode / link turn

`integrations/pipelines/product-resolve.ts` → `resolveProductsFromText()`:

1. Parse URLs → exact `website_url`, then code/barcode in the URL.
2. Exact product code / barcode typed in the message.
3. Keyword search **+** semantic vector search, merged and de-duplicated.

In the Messenger pipeline:
- A product/price/link question that resolves → a code-built numbered option list
  (reliable, never truncated, never a hallucinated price).
- Anything else (greetings, "how much?", "the one I sent", "other colors?") →
  `chatReplyWithTools()` — Gemini answers naturally with customer memory in
  context and the read tools available for live lookups.

---

## Image turn (`integrations/pipelines/image-match.ts`)

Hybrid recognition, strongest signal first:

1. Exact product image URL.
2. dHash perceptual fingerprint of the customer image.
3. **Learned** match — admin corrections (`image_match_corrections` +
   `product_fingerprints`).
4. Near-duplicate fingerprint vs. stored product image hashes.
5. Gemini vision describe → visible code/barcode → exact lookup.
6. Candidate retrieval: keyword search + **semantic vector search** (embedding of
   the vision description) + fingerprint-similar union.
7. Gemini vision ranking + multi-signal confidence (Gemini + pHash).

Image download is capped (8s timeout, 20 MB). If only an image arrives, the AI
identifies the product/options and replies with prices automatically; if
uncertain, it shows the top options and asks one useful clarifying question.

---

## Customer memory (`integrations/tools/memory.ts`, table `customer_memory`)

One persistent row per customer: rolling summary, recent resolved products,
preferences, known name/phone/address, durable facts. Loaded into every turn's
prompt so follow-ups work like a real conversation. Updated after each turn
(recent products + contact facts immediately; summary best-effort).

Admins **view / edit / clear** memory from the Inbox (right rail → Customer
memory panel).

---

## Vector search (real embeddings, JSONB cosine — not pgvector yet)

`embedText()` (in `integrations/gemini/client.ts`) calls the real Gemini
embedding model — **`gemini-embedding-001`** (current GA model, verified on the
project key, 768-dim via `outputDimensionality`). Override with
`GEMINI_EMBEDDING_MODEL` / `GEMINI_EMBEDDING_DIM`.

**Current implementation (intentional, simple, safe):**
- Product embeddings are stored as **JSON float arrays** in
  `products.text_embedding` (no `pgvector` extension, no HNSW index).
- Similarity is **cosine computed in app/server code** over a bounded scan
  (`integrations/tools/vector-search.ts`), consistent with the existing dHash scan.
- It **degrades safely**: if embeddings are not populated, or the key/model is
  unavailable, vector search returns `[]` and logs it. It never writes or matches
  a fake/random vector.
- **Next database/products pass** can upgrade this to native `pgvector` + HNSW if
  scale requires it — no API/contract change for callers.

Populate with: `cd scripts && npm run embeddings` (dry run: `DRY=1 npm run embeddings`).
Requires migration `0009` applied + a working `GEMINI_API_KEY`.

---

## Needs-human / AI paused behavior

There is no legacy escalation workflow and nothing is written to `escalations`
automatically. Instead, the Messenger pipeline sends one natural customer-facing
handoff message, then marks the conversation `needs_human` and sets
`ai_enabled=false` for cases that require an admin: order requests, payment /
refund / exchange / complaint questions, delivery details that are not stored,
unsafe image matches, and missing product price.

While paused, the AI generates nothing and the human takes over from the Inbox.

---

## AI Control (2 sections)

`/ai-control` exposes only what should be human-tuned:

1. **Customer Service Behavior** — service style and customer-service rules.
2. **Campaign / Marketing AI** — caption tone, campaign image guidance.

Advanced/internal behavior rows (product recommendation details, store facts,
campaign image guidance) are hidden behind the UI's advanced toggle. Everything
else (reply language, missing-price guardrail, image matching, tool usage, CSV
truth, confidence thresholds) is system-controlled in code so it can't be
misconfigured.

---

## Playground (`/ai-playground`)

Runs the **real** pipeline and shows two panels:

- **Customer reply** — the exact Libyan-Arabic message the customer would get
  (option list with prices for image/catalog questions), and whether it would
  auto-send.
- **Technical debug** — extracted signals (code/barcode/url/dHash), database
  candidates with retrieval tracks + confidence, image diagnostics, Gemini/tool
  calls, memory used, outcome, and the sanitizer result.

---

## Migrations required

| Migration | Adds | When |
|-----------|------|------|
| `0009_ai_brain.sql` | `customer_memory`, `products.text_embedding`, `product_fingerprints`, lookup indexes | required for memory + vector + learning |
| `0010_remove_facebook_comments.sql` | drops `facebook_comments`, removes obsolete behavior rows | after deploy |

Both are in `database/migrations/`. 0009 is additive/idempotent; the code
degrades gracefully if either has not been applied yet.
