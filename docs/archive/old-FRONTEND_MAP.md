# EH-SYSTEM1 — Frontend Map

> **Note (2026-06-12):** This map pre-dates the production cleanup pass and contains
> stale entries. The following pages, routes, and components **no longer exist**:
> `/catalog-sync`, `/orders`, `/api/catalog-sync`, `SyncConsole.tsx`, `OrderDraftPanel.tsx`.
> Inbox order-draft actions (`create_order_draft`, `ai_draft_order`, `confirm_order`) were
> also removed. Dashboard no longer reads the `orders` table.
> See `docs/PRODUCTION.md` for the authoritative current-state guide.

Complete map of the admin frontend (Next.js App Router, `admin-app/src/`) after
the AI brain rebuild. For the next frontend pass, read this first, then
[FRONTEND_AUDIT.md](FRONTEND_AUDIT.md) and [FRONTEND_CODEX_PASS.md](FRONTEND_CODEX_PASS.md).

Conventions: pages are server components unless noted; `'use client'` components
talk to the app's own `/api/*` routes (never to Supabase from the browser with
the service role). The `/facebook/comments` page was **deleted** (comments feature removed).

---

## 1. App routes / pages

| Route | File | Purpose | Uses components | Calls APIs | Reads DB directly? | Status |
|-------|------|---------|-----------------|------------|--------------------|--------|
| `/` | `app/page.tsx` | Redirect → `/dashboard` | — | — | No | OK |
| `/login` | `app/login/page.tsx` | Supabase Auth sign-in | (auth form) | Supabase auth (browser) | No | OK |
| `/dashboard` | `app/(dashboard)/dashboard/page.tsx` | Ops overview, KPIs, catalog diagnostics | SystemStatus, Diagnostics, NotConnected, ui | — | Yes (server, service role) | OK (comments KPI removed) |
| `/inbox` | `app/(dashboard)/inbox/page.tsx` | Conversation list (needs-action first) | ui, AutoRefresh | — | Yes (server) | OK |
| `/inbox/[conversationId]` | `app/(dashboard)/inbox/[conversationId]/page.tsx` | Conversation detail + memory + AI pause | ConversationWorkspace, AiControls, **CustomerMemoryPanel**, CustomerInfoPanel | `/api/inbox/[id]` | Yes (server) | OK (memory added) |
| `/products` | `app/(dashboard)/products/page.tsx` | Catalog list + filters | ProductsToolbar, ui | (server query) | Yes (server) | OK |
| `/products/[productId]` | `app/(dashboard)/products/[productId]/page.tsx` | Product editor | ProductEditor, ProductGallery | `/api/products/[id]` | Yes (server) | OK (shows source_name labeled "Turkish, reference") |
| `/campaigns` | `app/(dashboard)/campaigns/page.tsx` | Campaign list | ui | — | Yes (server) | OK |
| `/campaigns/new` | `app/(dashboard)/campaigns/new/page.tsx` | New campaign | CampaignBuilder | `/api/campaigns` | Yes (server) | OK |
| `/campaigns/[campaignId]` | `app/(dashboard)/campaigns/[campaignId]/page.tsx` | Campaign editor + publish | CampaignBuilder, AssetManager, CaptionPanel, PostComposer | `/api/campaigns/[id]`, `/assets` | Yes (server) | OK |
| `/catalog-match` | `app/(dashboard)/catalog-match/page.tsx` | Scraper↔CSV image match review | CatalogMatch, Diagnostics | `/api/catalog-match/*` | Yes (server) | OK |
| `/catalog-review` | `app/(dashboard)/catalog-review/page.tsx` | Staged (unpriced) products queue | CatalogReviewTabs | — | Yes (server) | OK |
| `/catalog-sync` | `app/(dashboard)/catalog-sync/page.tsx` | CSV/scraper sync console | SyncConsole, Diagnostics | `/api/catalog-sync` | Yes (server) | OK |
| `/image-review` | `app/(dashboard)/image-review/page.tsx` | Image-match correction history | ImageReviewClient | `/api/image-review/[id]` | Yes (server) | OK (now feeds fingerprint learning) |
| `/price-review` | `app/(dashboard)/price-review/page.tsx` | Price staging + activation | PriceReviewCard | `/api/products/[id]/price` | Yes (server) | OK |
| `/ai-control` | `app/(dashboard)/ai-control/page.tsx` | AI behavior config (2 sections) | AiBehaviors | `/api/ai/behaviors` | Yes (server) | OK (simplified) |
| `/ai-playground` | `app/(dashboard)/ai-playground/page.tsx` | Real-workflow tester | Playground | `/api/ai/playground` | No | OK (rebuilt) |
| `/analytics` | `app/(dashboard)/analytics/page.tsx` | KPIs | ui | — | Yes (server) | OK (comments KPI removed) |
| `/orders` | `app/(dashboard)/orders/page.tsx` | Order drafts list | ui | — | Yes (server) | OK |
| `/logs` | `app/(dashboard)/logs/page.tsx` | Activity + integration logs | ui | — | Yes (server) | OK |
| `/settings` | `app/(dashboard)/settings/page.tsx` | Integration status, webhook URL, readiness, theme/lang | SystemStatus, LanguageSwitcher, ThemeToggle | — | Yes (server) | OK |
| ~~`/facebook/comments`~~ | (deleted) | Comments feature | — | — | — | **REMOVED** |

---

## 2. API routes (called by the frontend / Meta)

| API route | File | Called by | Purpose | Writes DB? | External service? | Status |
|-----------|------|-----------|---------|------------|-------------------|--------|
| `/api/ai/behaviors` | `api/ai/behaviors/route.ts` | AI Control | GET list / PATCH a behavior | Yes (ai_behaviors) | — | OK |
| `/api/ai/playground` | `api/ai/playground/route.ts` | Playground, AI Control test | Run real workflow; return reply + debug | No (ai_events only) | Gemini, tools | OK (rebuilt) |
| `/api/inbox/[conversationId]` | `api/inbox/[conversationId]/route.ts` | ConversationWorkspace, AiControls, CustomerMemoryPanel | Thread fetch + actions (send, suggest, pause/resume, order draft, correct_image_match, **get/update/clear memory**) | Yes | Meta send, Gemini | OK |
| `/api/products/search` | `api/products/search/route.ts` | ConversationWorkspace product search | Search catalog | No | — | OK |
| `/api/products/[productId]` | `api/products/[productId]/route.ts` | ProductEditor | Product CRUD (admin-lock aware) | Yes | — | OK |
| `/api/products/[productId]/price` | `api/products/[productId]/price/route.ts` | PriceReviewCard | Price staging / activation | Yes | — | OK |
| `/api/campaigns` | `api/campaigns/route.ts` | CampaignBuilder | Campaign list/create | Yes | — | OK |
| `/api/campaigns/[campaignId]` | `api/campaigns/[campaignId]/route.ts` | Campaign editor | Campaign CRUD + publish | Yes | Meta publish | OK |
| `/api/campaigns/[campaignId]/assets` | `api/campaigns/[campaignId]/assets/route.ts` | AssetManager | Asset management | Yes | Storage | OK |
| `/api/catalog-match` | `api/catalog-match/route.ts` | CatalogMatch | Paginated suggestions | No | — | OK |
| `/api/catalog-match/approve` | `.../approve/route.ts` | CatalogMatch | Approve match → attach images | Yes | — | OK |
| `/api/catalog-match/reject` | `.../reject/route.ts` | CatalogMatch | Reject match | Yes | — | OK |
| `/api/catalog-match/mark` | `.../mark/route.ts` | CatalogMatch | Mark needs_review/no_match | Yes | — | OK |
| `/api/catalog-match/refresh` | `.../refresh/route.ts` | CatalogMatch | Re-run scorer | Yes | — | OK |
| `/api/catalog-sync` | `api/catalog-sync/route.ts` | SyncConsole | Trigger a sync run | Yes | — | OK |
| `/api/cron/campaign-scheduler` | `api/cron/campaign-scheduler/route.ts` | Cron (auth via secret) | Pricing refresh + auto-publish | Yes | Meta publish | OK |
| `/api/image-review/[correctionId]` | `api/image-review/[correctionId]/route.ts` | ImageReviewClient | Save correction → **fingerprint learning** | Yes (corrections + fingerprints) | — | OK |
| `/api/health` | `api/health/route.ts` | UI / uptime checks | Integration health JSON | No | — | OK |
| `/api/meta/webhook` | `api/meta/webhook/route.ts` | **Meta (Messenger)** | Verify + ingest messages → AI turn | Yes | Meta, Gemini, tools | OK (comments processing removed) |
| ~~`/api/webhooks/messenger`, `/api/webhooks/facebook-comments`~~ | (deleted) | — | legacy split webhooks | — | — | **REMOVED** |

---

## 3. Component inventory

| Component | File | Used by | Purpose | Client/server | Props summary | Status |
|-----------|------|---------|---------|---------------|---------------|--------|
| ui (primitives) | `components/ui.tsx` | everywhere (16+) | Card, Badge, StatCard, PageHeader, Notice, etc. | mixed | many | Core |
| Sidebar | `components/Sidebar.tsx` | dashboard layout | Left nav (from `lib/nav.ts`) | client | locale | OK (comments link removed) |
| Topbar | `components/Topbar.tsx` | dashboard layout | Search, theme, language | client | locale | OK |
| MobileNav | `components/MobileNav.tsx` | dashboard layout | Mobile nav drawer | client | nav | OK |
| SearchBar | `components/SearchBar.tsx` | Topbar | Global search input | client | — | OK |
| ThemeToggle | `components/ThemeToggle.tsx` | settings, topbar | Dark/light toggle | client | initial | OK |
| LanguageSwitcher | `components/LanguageSwitcher.tsx` | settings, topbar | AR/EN switch | client | locale | OK |
| AutoRefresh | `components/AutoRefresh.tsx` | inbox list | Polling wrapper | client | intervalMs | OK |
| NotConnected | `components/NotConnected.tsx` | most pages | "integration not configured" card | server | status | Core |
| ~~Tabs~~ | `components/Tabs.tsx` | — | Tab primitive | client | — | **REMOVED (0 importers)** |
| AiBehaviors | `components/ai/AiBehaviors.tsx` | /ai-control | 2-section behavior editor + quick test | client | behaviors, locale, geminiConnected | OK (rebuilt) |
| Playground | `components/ai/Playground.tsx` | /ai-playground | Two-panel workflow tester | client | locale | OK (rebuilt) |
| ConversationWorkspace | `components/inbox/ConversationWorkspace.tsx` | inbox detail | Thread + composer + candidate options + correction | client | conversationId, messages, candidates | OK |
| AiControls | `components/inbox/AiControls.tsx` | inbox detail | AI pause/resume (manual handoff) | client | conversationId, aiEnabled | OK |
| **CustomerMemoryPanel** | `components/inbox/CustomerMemoryPanel.tsx` | inbox detail | View/edit/clear customer memory | client | conversationId, memory, locale | **NEW** |
| CustomerInfoPanel | `components/inbox/CustomerInfoPanel.tsx` | inbox detail | Customer profile | server | customer, conversation | OK |
| ~~OrderDraftPanel~~ | `components/inbox/OrderDraftPanel.tsx` | — | Order draft extraction panel | client | — | **REMOVED (0 importers)** |
| CampaignBuilder | `components/campaigns/CampaignBuilder.tsx` | campaigns new/edit | Campaign form | client | campaign | OK |
| AssetManager | `components/campaigns/AssetManager.tsx` | campaign edit | Asset panel | client | campaignId | OK |
| CaptionPanel | `components/campaigns/CaptionPanel.tsx` | campaign edit | AI caption generation | client | campaignId | OK |
| PostComposer | `components/campaigns/PostComposer.tsx` | campaign edit | Post preview + publish | client | campaignId | OK |
| CatalogMatch | `components/catalog/CatalogMatch.tsx` | /catalog-match | Match review UI | client | rows | OK |
| CatalogReviewTabs | `components/catalog/CatalogReviewTabs.tsx` | /catalog-review | Staged review tabs | client | rows | OK |
| Diagnostics | `components/catalog/Diagnostics.tsx` | dashboard, catalog-match, catalog-sync | Catalog stat tiles | server | stats | OK |
| SyncConsole | `components/catalog/SyncConsole.tsx` | /catalog-sync | Sync run console | client | state | OK |
| SystemStatus | `components/dashboard/SystemStatus.tsx` | dashboard, settings | Integration status cards | server | statuses | OK |
| ImageReviewClient | `components/image-review/ImageReviewClient.tsx` | /image-review | Correction UI | client | rows | OK |
| PriceReviewCard | `components/products/PriceReviewCard.tsx` | /price-review | Price staging card | client | item | OK |
| ProductEditor | `components/products/ProductEditor.tsx` | product detail | Edit form | client | product | OK |
| ProductGallery | `components/products/ProductGallery.tsx` | product detail | Image gallery | client | images | OK |
| ProductsToolbar | `components/products/ProductsToolbar.tsx` | /products | List toolbar | client | filters | OK |

---

## 4. Frontend data flow (by section)

- **Dashboard** — server reads conversations/orders/products/ai_events/catalog stats; displays KPIs + needs-action queue + recent activity. No customer-facing actions.
- **Inbox** — list polls via AutoRefresh; detail page (`ConversationWorkspace`) polls `/api/inbox/[id]`, can send a human message (Meta send → **customer-facing**), AI suggest, pause/resume AI, correct an image match (writes fingerprint), and create/AI-fill an order draft. `CustomerMemoryPanel` reads/writes memory via the same route.
- **Customer memory panel** — `get_memory`/`update_memory`/`clear_memory` actions; admin-only, not customer-facing.
- **AI Control** — `AiBehaviors` GET/PATCH `ai_behaviors`; affects live customer replies (tone/rules) immediately. Quick-test calls `/api/ai/playground`.
- **AI Playground** — runs the **real** pipeline via `/api/ai/playground`; shows the exact customer reply + debug. Writes nothing customer-facing.
- **Products / Price review** — admin edits names/prices; activating a product makes it **customer-visible** (high impact). Admin-lock enforced server-side.
- **Catalog Match / Sync** — admin links scraper images to CSV products; refresh re-runs the scorer. No customer-facing sends.
- **Image Review** — admin confirms the right product for a customer image → writes `product_fingerprints` so future matching improves.
- **Campaigns** — build campaign, generate caption (Gemini), publish to Facebook Page (**outward-facing publish**).
- **Orders / Analytics / Logs / Settings** — read/admin only; Settings shows env status + the single webhook URL + readiness.

---

## 5. Frontend risk map

| File/component | Risk | Why | Should Codex touch? |
|----------------|------|-----|---------------------|
| `ConversationWorkspace.tsx` | **Critical** | Sends customer-facing Messenger text; correction writes | Carefully (UI only; keep API calls/actions identical) |
| `AiControls.tsx` | **Critical** | Pause/resume = the only handoff control | Carefully (don't change action names) |
| `PostComposer.tsx` / campaign publish | **Critical** | Publishes to the public Facebook Page | Carefully |
| `PriceReviewCard.tsx` + `/price` route | **Critical** | Activates products → customer-visible | Carefully |
| `Playground.tsx` | High | Calls real pipeline; safe (no send) but complex | Yes (readability) |
| `AiBehaviors.tsx` | High | Edits live behavior | Yes (UI), keep PATCH contract |
| `CustomerMemoryPanel.tsx` | High | Writes/clears memory | Yes (UI), keep action names |
| `CatalogMatch.tsx`, `ImageReviewClient.tsx`, `ProductEditor.tsx`, `CampaignBuilder.tsx`, `AssetManager.tsx`, `SyncConsole.tsx` | Medium | Admin workflow writes | Yes (forms/UX), keep API contracts |
| `ui.tsx`, `Sidebar/Topbar/MobileNav`, `NotConnected`, `Diagnostics`, `SystemStatus`, dashboard/analytics/logs/settings pages | Low | Display only | Yes (visual polish) |
| `Tabs.tsx`, `OrderDraftPanel.tsx` | Dead | 0 importers | Delete after manual confirm |

---

## 6. Unused / dead frontend inventory

| File | Why appears unused | Safe to delete? | Needs manual check? |
|------|--------------------|-----------------|---------------------|
| `components/Tabs.tsx` | 0 importers across `app/` + `components/` | Deleted in Codex production pass | — |
| `components/inbox/OrderDraftPanel.tsx` | 0 importers; order-draft UI is handled inline in `ConversationWorkspace` + `/api/inbox` actions | Deleted in Codex production pass | — |

> Detection method: `grep -rl "\b<Component>\b" app components --include="*.tsx"` excluding the component's own file. Both returned 0. Not deleted in this pass (not required for production); flagged for the frontend pass.
