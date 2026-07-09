# EH-SYSTEM1 — Frontend Audit

Quality audit of the admin frontend after the AI brain rebuild, to scope the next
(Codex) frontend pass. Pair with [FRONTEND_MAP.md](FRONTEND_MAP.md) and
[FRONTEND_CODEX_PASS.md](FRONTEND_CODEX_PASS.md).

The frontend **builds clean** (`tsc` + `next build` pass, 42 routes). This audit is
about consistency/UX, not breakage.

## 1. Current frontend problems
- Dead components (`Tabs.tsx`, `OrderDraftPanel.tsx`) were removed after confirming 0 importers.
- Page headers/empty/loading states are not uniform across pages.
- The Playground was just rebuilt with a raw JSON debug panel — functional but not polished.
- AI Control was simplified to 2 sections — verify nothing references the old per-behavior boxes.
- Inbox right rail now has three stacked panels (AiControls, CustomerMemoryPanel, CustomerInfoPanel) — needs a consistent visual rhythm.

## 2. Broken or confusing pages
- None broken. Potential confusion: `/orders` is a thin list; order drafting lives in the Inbox. Make the relationship clear.
- `/catalog-review`, `/catalog-match`, `/catalog-sync`, `/price-review`, `/image-review` overlap conceptually; a clearer catalog/ops grouping would help.

## 3. Duplicated UI patterns
- Product card/line markup is repeated in `ConversationWorkspace`, `CatalogMatch`, `PriceReviewCard`, `ProductGallery`. Candidate for a shared `ProductCard`.
- "Thumb / image with fallback" is implemented in multiple components.
- Status badges/tones partly centralized in `lib/status-tone.ts` but not used everywhere.

## 4. Dead routes / components
- Routes: `/facebook/comments` (deleted), `/api/webhooks/*` (deleted) — confirm no nav/link remnants (none found).
- Components: `Tabs.tsx`, `OrderDraftPanel.tsx` removed after 0-importer confirmation.

## 5. Pages affected by the AI rebuild
- Inbox detail (memory panel added), AI Playground (rebuilt), AI Control (simplified), dashboard + analytics (comments KPIs removed), image-review (now feeds learning).

## 6. Pages affected by Facebook comments removal
- Deleted `/facebook/comments`; removed nav item + i18n keys; dashboard "comments to reply" KPI + card removed; analytics "comments answered" stat removed. Verify no leftover empty marketing-group spacing in the sidebar.

## 7. Pages affected by customer memory
- Inbox detail renders `CustomerMemoryPanel`. It needs good empty/edit/save/clear states and confirmation on clear (already has a confirm()).

## 8. Pages affected by the Playground rebuild
- `/ai-playground` is now a real-workflow tester (two panels). The debug panel uses collapsible JSON sections — readable but could be prettier (typed chips, candidate cards).

## 9. Pages affected by AI Control simplification
- `/ai-control` shows only Customer Service + Campaign/Marketing groups. The page subtitle/help text should match (no "configure each behavior" language implying many boxes).

## 10. Components Codex should NOT touch (logic/contract)
- `ConversationWorkspace.tsx` action names + `/api/inbox` calls (customer sends).
- `AiControls.tsx` pause/resume action names.
- `PostComposer.tsx` / campaign publish flow.
- `PriceReviewCard.tsx` price/activate calls.
- `CustomerMemoryPanel.tsx` action names (`get_memory`/`update_memory`/`clear_memory`).
- Any `/api/*` route file (backend).

## 11. Components Codex should rewrite (UI/UX)
- `Playground.tsx` debug panel → structured, readable cards instead of raw JSON.
- `AiBehaviors.tsx` → cleaner two-section layout, consistent cards.
- Inbox right rail → unify the three panels visually.
- Page headers across all pages → one `PageHeader` pattern.

## 12. Components deleted
- `Tabs.tsx`, `OrderDraftPanel.tsx` (0 importers).

## 13. Frontend consistency issues
- Mixed spacing/typography between older pages (products, catalog) and newer ones (playground, memory panel).
- Buttons: `btn-primary` / `btn-ghost` / `btn-subtle` used inconsistently.
- Arabic/RTL handling is good (`dir="auto"`) but verify new panels keep it.

## 14. Missing loading / error / empty states
- Several server pages lack explicit loading skeletons (rely on server render).
- `CustomerMemoryPanel` has empty/edit states but no inline error toast on save failure.
- `Playground` shows errors but no per-section loading indicators.

## 15. Mobile / responsive issues (obvious)
- Inbox detail two-column grid (`lg:grid-cols-[1fr_340px]`) collapses on mobile but the right-rail panels stack heavily — review order/priority on small screens.
- Playground two-panel grid stacks on mobile (OK); debug JSON can overflow — already `overflow-auto`.

## 16. High-risk customer-facing actions (guard in any redesign)
- Inbox "Send" (human message → Messenger) and "Send options".
- Campaign publish (public Facebook post).
- Product activation / price save (makes products customer-visible).
- AI Control behavior save (changes live replies).
- These must keep their confirmations and exact API calls through any visual rework.
