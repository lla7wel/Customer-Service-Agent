# docs/archive — Historical Documents

These files are historical only. They document earlier design phases, planning passes, pre-cleanup architecture, and completed task checklists.

**They are not current production instructions.** Where they conflict with the live docs (`ARCHITECTURE.md`, `OPERATIONS.md`, `DATABASE.md`, `AI_AND_MESSENGER.md`, etc.), the live docs win.

| File | What it was |
|------|-------------|
| `old-PRD.md` | Original product spec. References Orders and Facebook comments (both removed). |
| `old-REPO_MAP.md` | File-by-file repo map. Stale entries noted at top; superseded by `ARCHITECTURE.md`. |
| `old-FRONTEND_MAP.md` | Route/component map from before the production cleanup pass. |
| `old-FRONTEND_AUDIT.md` | UI quality audit that preceded the frontend hardening pass. |
| `old-FRONTEND_CODEX_PASS.md` | Task guide for the frontend Codex pass (completed). |
| `old-SUPABASE_SCHEMA_MAP.md` | Schema map written before migration 0012. Stale: includes `orders`, `order_items`, `escalations`, `product_variants`, `ai_settings`, `conversations.order_draft_id`, `campaigns.comment_reply_rules`. See `DATABASE.md` for current schema. |
| `old-PIPELINE_MAP.md` | Messenger / image-match / campaign data-flow diagrams. Still largely accurate but superseded by `AI_AND_MESSENGER.md`. |
| `old-META_SYSTEM_MAP.md` | Meta webhook endpoint map. Superseded by `AI_AND_MESSENGER.md`. |
| `old-AI_BRAIN.md` | AI product-recognition brain doc (pre-supersede-guard). Superseded by `AI_AND_MESSENGER.md`. |
| `old-ENV.md` | Environment variable reference. Superseded by `DEPLOYMENT.md`. |
| `old-SETUP.md` | First-time setup guide. References old "Catalog Sync page" flow (removed). Superseded by `DEPLOYMENT.md` and `OPERATIONS.md`. |
| `old-PRODUCTION.md` | Post-cleanup authoritative doc. Content distributed into the new doc suite. |
| `old-EDITING_GUIDE.md` | Risk-level guide for each source file. Key guidance merged into `ARCHITECTURE.md`. |
| `old-UPGRADE-DEPLOY-CHECKLIST.md` | AI-brain rebuild deploy checklist (completed). |
