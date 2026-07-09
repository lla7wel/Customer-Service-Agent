# EH-SYSTEM1 — Frontend Pass Guide (for Codex)

Precise guide for the next frontend pass, on top of the deployed AI-brain version.
Read [FRONTEND_MAP.md](FRONTEND_MAP.md) and [FRONTEND_AUDIT.md](FRONTEND_AUDIT.md)
first. This is a **UI/UX pass** — not a backend or AI-logic change.

## 1. Goal
Make the admin frontend clean, modern, consistent, responsive, and aligned with
the new AI brain (database-aware product recognition, customer memory, real-workflow
Playground, simplified AI Control, no Facebook comments, no auto-escalation).

## 2. Non-negotiable constraints (must NOT break)
- Messenger inbox send + AI pause/resume (`ai_enabled` is the only handoff).
- AI product recognition (text/image/code/barcode/link/vector) and its `/api/*` calls.
- Customer memory actions (`get_memory` / `update_memory` / `clear_memory`).
- Campaign caption generation + Facebook post/campaign publishing.
- Product activation/pricing flow (makes products customer-visible).
- Supabase auth, the Meta webhook route, the AI Playground workflow, AI Control behavior contract.
- Do NOT restore Facebook comments or automatic escalation.
- Do NOT expose Turkish `source_name` to customers; customer text uses `customerProductName()`.

## 3. Files Codex SHOULD touch (UI/UX)
- **Layout / navigation:** `components/Sidebar.tsx`, `Topbar.tsx`, `MobileNav.tsx`, `lib/nav.ts`.
- **Dashboard:** `app/(dashboard)/dashboard/page.tsx`, `components/dashboard/SystemStatus.tsx`, `components/catalog/Diagnostics.tsx`.
- **Inbox:** `components/inbox/ConversationWorkspace.tsx` (visuals only), `AiControls.tsx`, `CustomerMemoryPanel.tsx`, `CustomerInfoPanel.tsx`.
- **AI Playground:** `components/ai/Playground.tsx` (make the debug panel structured/readable).
- **AI Control:** `components/ai/AiBehaviors.tsx`, `app/(dashboard)/ai-control/page.tsx`.
- **Products / catalog:** `components/products/*`, `components/catalog/*`, related pages.
- **Campaigns:** `components/campaigns/*`.
- **Settings / logs / analytics:** those pages + `components/ui.tsx` primitives.
- **Shared UI:** `components/ui.tsx`, `components/NotConnected.tsx`, `lib/status-tone.ts`.

## 4. Files Codex should AVOID or touch carefully
- All of `admin-app/src/app/api/**` (backend route handlers).
- All of `integrations/**` (AI brain, tools, pipelines, Meta, Gemini, Supabase).
- `lib/supabase/*`, `lib/readiness.ts`, `lib/catalog.ts`, `lib/data.ts` (data access).
- Inbox/campaign/price components' **action names + fetch calls** — keep identical.

## 5. Frontend cleanup tasks
- Delete dead components after confirming 0 importers: `components/Tabs.tsx`, `components/inbox/OrderDraftPanel.tsx`.
- Unify page headers into one `PageHeader` usage; consistent spacing/typography.
- Extract a shared `ProductCard` / image-thumbnail-with-fallback used by inbox, catalog, price-review, gallery.
- Add consistent loading / empty / error states (especially memory panel save errors, playground per-section loading).
- Make the Playground debug panel readable: typed signal chips, candidate cards with confidence + retrieval tracks, collapsible raw JSON as a last resort.
- Make `CustomerMemoryPanel` clean and obviously editable; keep the clear-confirm.
- Tidy the inbox right rail (AiControls + memory + customer info) into a consistent stack.
- Verify sidebar has no empty marketing group / dead links after comments removal.
- Improve mobile layout for inbox detail and playground.
- Standardize buttons (`btn-primary` / `btn-ghost` / `btn-subtle`) usage.

## 6. Before/after checklist for Codex
- `cd admin-app && npx tsc --noEmit` → clean
- `cd admin-app && npx next build` → compiled successfully
- `cd scripts && npx tsc --noEmit && npm test` → still pass (should be untouched)
- Grep stays clean: no `facebook_comment` / `replyToComment` / `escalate_human` reintroduced; no customer-facing `source_name`.

---

## 7. Ready-to-copy Codex prompt

```
You are doing a FRONTEND-ONLY UI/UX pass on EH-SYSTEM1 (Next.js App Router,
admin-app/src). The backend AI brain is already built and deployed — do not change it.

FIRST: read docs/FRONTEND_MAP.md, docs/FRONTEND_AUDIT.md, and docs/AI_BRAIN.md.

GOAL: make the admin frontend clean, modern, consistent, and responsive, aligned
with the current architecture (database-aware AI product recognition, customer
memory, real-workflow Playground, 2-section AI Control, NO Facebook comments, NO
automatic escalation).

HARD CONSTRAINTS — do NOT break or change:
- Any file under admin-app/src/app/api/** (backend routes).
- Anything under integrations/** (AI brain, tools, pipelines, Meta, Gemini, Supabase).
- Action names and fetch() calls in ConversationWorkspace, AiControls,
  CustomerMemoryPanel, PostComposer, PriceReviewCard, CampaignBuilder, AssetManager,
  AiBehaviors (keep the exact /api contracts).
- Do NOT restore Facebook comments or automatic escalation.
- Do NOT expose Turkish source_name to customers; customer-facing names use customerProductName().
- Keep RTL/Arabic (dir="auto") working.

ALLOWED: edit UI/layout/styling in components/** and (dashboard) pages; unify
PageHeader/cards/tables/forms; add loading/empty/error states; restructure the
Playground debug panel for readability; tidy the inbox right rail; standardize
buttons; improve mobile layout.

CLEANUP: delete components/Tabs.tsx and components/inbox/OrderDraftPanel.tsx ONLY
after confirming 0 importers (grep -rl). 

WHEN DONE:
- run `cd admin-app && npx tsc --noEmit` and `npx next build` (must pass),
- run `cd scripts && npm test` (must still pass — you shouldn't have touched it),
- report every file changed and deleted,
- do NOT deploy and do NOT run migrations unless explicitly asked.
```
