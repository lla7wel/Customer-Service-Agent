# EH-SYSTEM1 — Repository Map

> **Note (2026-06-12):** This map was last comprehensively updated before the production
> cleanup pass. The following have been **removed** and no longer exist:
> `admin-app/src/app/(dashboard)/orders/`, `admin-app/src/app/(dashboard)/catalog-sync/`,
> `admin-app/src/app/api/catalog-sync/`, `admin-app/src/lib/sync/runner.ts`,
> `admin-app/src/components/catalog/SyncConsole.tsx`,
> `admin-app/src/components/inbox/OrderDraftPanel.tsx`.
> `integrations/gemini/index.ts` no longer exports `extractOrderDraft`.
> See `docs/PRODUCTION.md` for the authoritative current-state guide.

> Navigation reference. Does not describe runtime behaviour — see the source files and
> `docs/PIPELINE_MAP.md` for data-flow details.

---

## Top-level layout

```
EH-SYSTEM1/
├── admin-app/          Next.js 14 App Router — the only browser-facing app
├── integrations/       Shared provider + pipeline layer (no framework deps)
├── workers/            Optional Cloudflare Workers (webhook + cron alternatives)
├── database/           Postgres schema, migrations, seed
├── scripts/            One-shot admin/import scripts (run locally, never deployed)
└── docs/               Architecture and navigation docs (this folder)
```

---

## `integrations/` — shared provider + pipeline layer

Everything that touches an external service or owns business-logic lives here.
Both the Next.js app and the Cloudflare workers import from this layer — that is
why it has **zero framework dependencies** (no Next.js, no React).

```
integrations/
├── env.ts                  Runtime-agnostic env reader (Node + Cloudflare Workers)
├── flags.ts                Runtime flags: ENABLE_MESSAGE_BATCHING, MESSAGE_BATCH_WINDOW_MS
├── status.ts               Integration health: supabaseStatus/geminiStatus/metaStatus/
│                           cloudflareStatus — drives the "not connected" UI
├── ai-behaviors.ts         Behavior loader + prompt composer (reads ai_behaviors table)
├── catalog-match.ts        Scoring engine: scraper ↔ CSV catalog matching (pure, no DB)
├── product-locks.ts        Admin-lock helpers: withLocks / stripLockedFields
│
├── meta/
│   └── index.ts            Meta Graph API client: sendMessage, publishPhoto,
│                           publishCarousel, getUserProfile, webhook verification
│
├── gemini/
│   ├── client.ts           Low-level Gemini REST client: generateContent,
│   │                       generateContentWithTools (function calling), embedText
│   └── index.ts            AI functions: chatReply, chatReplyWithTools, classifyIntent,
│                           matchProductFromImage, describeProductImage,
│                           rankProductsByImage, extractOrderDraft, caption,
│                           designPrompt, editImage
│
├── tools/                  Controlled DB tools (the AI brain's only catalog access)
│   ├── products.ts         findProductByCode/Barcode/Url, searchProductsByText,
│   │                       vectorSearchProductText, getProductPrice/Options
│   ├── memory.ts           Customer memory: get/update/clear + buildMemoryContext
│   ├── corrections.ts      saveImageCorrection (correction → fingerprint learning)
│   ├── vector-search.ts    cosineSimilarity over JSON embeddings (no pgvector)
│   ├── schemas.ts          Gemini function-call declarations + executor
│   └── types.ts            ProductCandidate + ToolResult + PRODUCT_COLUMNS
│
├── supabase/
│   ├── admin-client.ts     Service-role client — server/scripts/workers ONLY (bypasses RLS)
│   ├── index.ts            Re-export barrel (types + admin-client)
│   └── types.ts            Hand-maintained row types for the app's tables
│
├── pipelines/
│   ├── messenger.ts        Messenger agent pipeline (batch → memory → image/text turn)
│   ├── image-match.ts      Canonical image → product matcher (hybrid: dHash + vector + vision)
│   ├── product-resolve.ts  Text/URL → catalog resolver (code/barcode/url/keyword/vector)
│   ├── agent-policy.ts     Pure decision logic: decideAgentAction, isProductQuestion
│   │                       (image_turn | text_turn; handoff handled in messenger.ts)
│   └── campaign.ts         Campaign publish + pricing refresh (prepareCampaignPosts,
│                           publishPost, runSchedulerTick, refreshPricing)
│
└── util/
    ├── base64.ts           fetchImageBase64Detailed — image download for vision pipeline
    ├── customer-text.ts    sanitizeCustomerText / sanitizeCustomerTextDetailed — output safety
    ├── image-hash.ts       dHash perceptual fingerprinting + Hamming distance
    └── product-display.ts  customerProductName / originalProductName / primaryProductImageUrl
```

---

## `admin-app/` — Next.js application

```
admin-app/
├── src/
│   ├── app/
│   │   ├── layout.tsx                  Root layout (font, theme, i18n)
│   │   ├── page.tsx                    Root redirect → /dashboard
│   │   ├── login/page.tsx              Supabase Auth login
│   │   │
│   │   ├── (dashboard)/                Authenticated shell (layout.tsx wraps all pages)
│   │   │   ├── layout.tsx              Sidebar + Topbar shell
│   │   │   ├── dashboard/page.tsx      System status overview
│   │   │   ├── inbox/
│   │   │   │   ├── page.tsx            Conversation list
│   │   │   │   └── [conversationId]/page.tsx  Conversation detail
│   │   │   ├── products/
│   │   │   │   ├── page.tsx            Product catalogue list
│   │   │   │   └── [productId]/page.tsx       Product editor
│   │   │   ├── campaigns/
│   │   │   │   ├── page.tsx            Campaign list
│   │   │   │   ├── new/page.tsx        Campaign builder
│   │   │   │   └── [campaignId]/page.tsx      Campaign editor
│   │   │   ├── catalog-match/page.tsx  Scraper ↔ CSV match review
│   │   │   ├── catalog-review/page.tsx Staged (unpriced) products queue
│   │   │   ├── catalog-sync/page.tsx   CSV/scraper sync console
│   │   │   ├── image-review/page.tsx   Image-match correction history
│   │   │   ├── price-review/page.tsx   Price staging + activation
│   │   │   ├── ai-control/page.tsx     AI behavior config (2 sections: service, campaigns)
│   │   │   ├── ai-playground/page.tsx  Real-workflow tester (debug + customer reply)
│   │   │   ├── analytics/page.tsx      Conversation + AI stats
│   │   │   ├── orders/page.tsx         Order draft management
│   │   │   ├── logs/page.tsx           Integration log viewer
│   │   │   └── settings/page.tsx       App settings (webhook URL, env status)
│   │   │
│   │   └── api/
│   │       ├── meta/webhook/route.ts           ← CANONICAL Meta webhook (register this URL)
│   │       ├── ai/
│   │       │   ├── behaviors/route.ts          CRUD for ai_behaviors table
│   │       │   └── playground/route.ts         AI test endpoint (all tasks)
│   │       ├── campaigns/
│   │       │   ├── route.ts                    Campaign list/create
│   │       │   └── [campaignId]/
│   │       │       ├── route.ts                Campaign CRUD + publish
│   │       │       └── assets/route.ts         Campaign asset management
│   │       ├── catalog-match/
│   │       │   ├── route.ts                    Paginated suggestion list
│   │       │   ├── approve/route.ts            Approve a match
│   │       │   ├── reject/route.ts             Reject a match
│   │       │   ├── mark/route.ts               Mark needs_review / no_match
│   │       │   └── refresh/route.ts            Re-run the matcher
│   │       ├── catalog-sync/route.ts           Trigger a catalog sync run
│   │       ├── cron/campaign-scheduler/route.ts  Scheduler tick (auth required)
│   │       ├── image-review/[correctionId]/route.ts  Save admin image correction
│   │       ├── inbox/[conversationId]/route.ts       Conversation actions
│   │       ├── products/
│   │       │   ├── search/route.ts             Product search
│   │       │   └── [productId]/
│   │       │       ├── route.ts                Product CRUD
│   │       │       └── price/route.ts          Price review / activation
│   │       └── health/route.ts                 Liveness check
│   │
│   ├── components/
│   │   ├── ui.tsx                  Shared primitive components (Button, Badge, Card…)
│   │   ├── Sidebar.tsx             Navigation sidebar
│   │   ├── Topbar.tsx              Top bar (search, theme, language)
│   │   ├── MobileNav.tsx           Mobile nav drawer
│   │   ├── SearchBar.tsx           Global search bar
│   │   ├── Tabs.tsx                Tab primitive
│   │   ├── ThemeToggle.tsx         Dark/light mode toggle
│   │   ├── LanguageSwitcher.tsx    AR/EN switcher
│   │   ├── AutoRefresh.tsx         Polling wrapper for live pages
│   │   ├── NotConnected.tsx        "Not connected" state card
│   │   ├── ai/
│   │   │   ├── AiBehaviors.tsx     AI Control page client
│   │   │   └── Playground.tsx      AI Playground client
│   │   ├── campaigns/
│   │   │   ├── CampaignBuilder.tsx   Campaign create/edit form
│   │   │   ├── AssetManager.tsx      Campaign image asset panel
│   │   │   ├── CaptionPanel.tsx      AI caption generation panel
│   │   │   └── PostComposer.tsx      Post preview + publish panel
│   │   ├── catalog/
│   │   │   ├── CatalogMatch.tsx      Match review UI
│   │   │   ├── CatalogReviewTabs.tsx Staged product review tabs
│   │   │   ├── Diagnostics.tsx       Match diagnostics panel
│   │   │   └── SyncConsole.tsx       Sync run console
│   │   ├── dashboard/
│   │   │   └── SystemStatus.tsx      Integration status cards
│   │   ├── image-review/
│   │   │   └── ImageReviewClient.tsx Image correction UI
│   │   ├── inbox/
│   │   │   ├── ConversationWorkspace.tsx  Main conversation view
│   │   │   ├── AiControls.tsx             AI on/off (manual pause = the only handoff)
│   │   │   ├── CustomerMemoryPanel.tsx    View/edit/clear per-customer AI memory
│   │   │   ├── CustomerInfoPanel.tsx      Customer profile panel
│   │   │   └── OrderDraftPanel.tsx        Order draft extraction panel
│   │   └── products/
│   │       ├── ProductEditor.tsx      Product edit form
│   │       ├── ProductGallery.tsx     Product image gallery
│   │       ├── ProductsToolbar.tsx    Products list toolbar
│   │       └── PriceReviewCard.tsx    Price staging card
│   │
│   └── lib/
│       ├── supabase/
│       │   ├── db.ts       getDb() — service-role client alias for server components
│       │   ├── server.ts   getServerSupabase() — cookie-bound anon client (auth)
│       │   └── browser.ts  getBrowserSupabase() — browser anon client (RLS-bound)
│       ├── data.ts             fetchRows() — generic query helper with "not connected" state
│       ├── match.ts            Re-export barrel for catalog-match (server-only)
│       ├── catalog.ts          getCatalogStats() — catalog counts for dashboard/sync pages
│       ├── catalog-match-store.ts  refreshSuggestions / countByState (match workflow store)
│       ├── ai-behaviors.ts     loadBehaviors() — service-role behavior loader
│       ├── product-candidates.ts  toUiCandidate / productSelectColumns — UI row shaping
│       ├── readiness.ts        getReadiness() — go-live checklist
│       ├── format.ts           Currency/date formatting helpers
│       ├── nav.ts              Sidebar navigation config
│       ├── status-tone.ts      Status → colour/label mapping
│       ├── theme.ts            Theme helpers (client)
│       ├── theme-server.ts     Theme helpers (server)
│       └── i18n/
│           ├── config.ts       Supported locales
│           ├── dictionaries.ts Translation loader
│           └── server.ts       Server-side i18n helper
```

---

## `workers/` — Optional campaign scheduler (Cloudflare cron)

Deploy only when you want the pricing-refresh cron off the Next.js runtime.
The only remaining worker is `campaign-scheduler`; webhook workers were deleted.
It imports the same `integrations/pipelines/campaign.ts` logic the Next.js cron uses.

```
workers/
└── campaign-scheduler/src/index.ts        Cloudflare cron Worker: scheduler tick
```

---

## `database/`

```
database/
├── schema.sql                  Full schema (apply once to a fresh project)
├── seed/seed.sql               Optional seed data
└── migrations/
    ├── 0001_init.sql           Initial tables
    ├── 0002_price_review_staging.sql   Price staging workflow
    ├── 0003_catalog_match_suggestions.sql  Match state machine
    ├── 0004_admin_locked_fields.sql    Admin-lock column
    ├── 0005_ai_behaviors.sql           Per-behavior ai_behaviors table
    ├── 0006_message_batching.sql       Burst-debounce support
    ├── 0007_image_fingerprints.sql     Perceptual hash columns
    └── 0008_campaign_asset_review.sql  Asset approval workflow
```

---

## `scripts/`

One-shot local scripts; never deployed. Require `.env` in the repo root.

```
scripts/
├── _lib.ts                         Shared script utilities
├── import-csv-catalog.ts           Import CSV product data
├── import-scraper-products.ts      Import scraper JSON into DB
├── enrich-catalog.ts               Enrich existing products
├── catalog-image-match.ts          Run catalog image matcher
├── generate-image-fingerprints.ts  Compute perceptual hashes for all images
├── upload-product-images.ts        Push images to Supabase Storage
├── validate-import.ts              Sanity-check an import run
├── ai-control-behavior-test.ts     Test AI behaviors end-to-end
└── upgrade-tests.ts                Pre-deploy smoke tests
```
