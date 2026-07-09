/**
 * Admin-app wrapper around the canonical behavior loader in @integrations.
 * The admin app uses the service-role client; the prompt-composition helpers
 * (behaviorText / customerSystemPrompt / sharedMemory) are re-exported so the
 * Playground, AI Control and campaigns use the exact same logic the live
 * webhook pipelines use.
 */
import { adminClient } from '@integrations/supabase/admin-client';
import { loadBehaviorsWith, type BehaviorMap } from '@integrations/ai-behaviors';

export * from '@integrations/ai-behaviors';

/** Load all behaviors via the service-role client. Returns {} if not connected. */
export async function loadBehaviors(): Promise<BehaviorMap> {
  const db = adminClient();
  if (!db) return {};
  return loadBehaviorsWith(db);
}
