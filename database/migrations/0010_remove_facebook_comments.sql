-- =============================================================================
-- 0010_remove_facebook_comments.sql — remove the Facebook comments feature
-- =============================================================================
-- DESTRUCTIVE but scoped: drops ONLY the comments feature. Messenger, Meta
-- Messenger integration, facebook_posts, campaign publishing and campaign
-- captions are NOT touched.
--
-- Run AFTER deploying the code that no longer reads/writes facebook_comments.
-- Safe ordering: the table is only referenced by the (now deleted) comments
-- pipeline + comments page; dropping it has no effect on retained features.
-- =============================================================================

-- 1. Drop the comments table (and its indexes via cascade).
drop table if exists facebook_comments cascade;

-- 2. Remove obsolete AI behavior rows. The comments feature and the automatic
--    escalation behavior are both removed in this AI rebuild; the AI now answers
--    everything and is only paused manually via ai_enabled.
delete from ai_behaviors where behavior_key in ('facebook_comment', 'escalation');

-- =============================================================================
-- ROLLBACK (manual): recreate facebook_comments from an earlier schema.sql and
-- re-insert the deleted ai_behaviors rows. The comments feature code has been
-- deleted, so a rollback is only meaningful alongside a code revert.
-- =============================================================================
