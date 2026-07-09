/**
 * Admin-app wrapper around the canonical behavior loader in @integrations.
 * The prompt-composition helpers (behaviorText / customerSystemPrompt /
 * sharedMemory) are re-exported so the Playground, AI Control and campaigns
 * use the exact same logic the live webhook pipelines use.
 */
import { getDb } from '@integrations/db/client';
import { loadBehaviorsWith, type BehaviorMap } from '@integrations/ai-behaviors';

export * from '@integrations/ai-behaviors';

/** Load all behaviors. Returns {} if the database is not connected. */
export async function loadBehaviors(): Promise<BehaviorMap> {
  const db = getDb();
  if (!db) return {};
  return loadBehaviorsWith(db);
}
