/**
 * Canonical AI-behavior loader + prompt composer, shared by the admin app AND
 * the live webhook pipelines so a customer reply in production is built from
 * EXACTLY the same behavior rows the admin tests in the Playground / AI
 * Control. Takes a database handle so it is framework-agnostic.
 *
 * Behaviors come from the ai_behaviors table (one row per behavior_key). A
 * disabled row is omitted. Required missing rows fail prompt compilation rather
 * than silently falling back to provider defaults.
 */
import type { Kysely } from 'kysely';
import type { DB } from './db/types';
import { compilePrompt, type AiTask } from './prompt-compiler';

export interface AiBehaviorRow {
  behavior_key: string;
  title?: string | null;
  prompt: string | null;
  rules: string | null;
  memory: string | null;
  enabled: boolean;
  updated_at?: string | null;
}

export type BehaviorMap = Record<string, AiBehaviorRow>;

export type AiBehaviorTask =
  | 'customer_chat'
  | 'inbox_suggest'
  | 'messenger'
  | 'campaign_caption'
  | 'campaign_image'
  | 'image_matching'
  | 'product_recommendation'
  | 'missing_price'
  | 'playground';

export interface ComposedBehavior {
  task: AiBehaviorTask;
  systemPrompt: string;
  behaviorKeys: string[];
  includedBehaviors: Array<{
    key: string;
    title: string;
    enabled: boolean;
    updated_at: string | null;
    fields: string[];
  }>;
  disabledBehaviorKeys: string[];
  toolsAllowed: string[];
  toolInstructions: string;
  metadata: {
    task: AiBehaviorTask;
    behavior_keys: string[];
    disabled_behavior_keys: string[];
    behaviors: Array<{
      key: string;
      title: string;
      enabled: boolean;
      updated_at: string | null;
      fields: string[];
    }>;
    tools_allowed: string[];
    prompt_version: string;
    hard_safety: string[];
  };
}

const LEGACY_TASK_MAP: Record<AiBehaviorTask, AiTask> = {
  customer_chat: 'customer_reply',
  inbox_suggest: 'customer_reply',
  messenger: 'customer_reply',
  campaign_caption: 'campaign_caption',
  campaign_image: 'campaign_image',
  image_matching: 'vision_rank',
  product_recommendation: 'product_recommendation',
  missing_price: 'customer_reply',
  playground: 'customer_reply',
};

/** Load all behaviors keyed by behavior_key. Returns {} on error/not-connected. */
export async function loadBehaviorsWith(db: Kysely<DB>): Promise<BehaviorMap> {
  let rows: AiBehaviorRow[] = [];
  try {
    rows = await db
      .selectFrom('ai_behaviors')
      .select(['behavior_key', 'title', 'prompt', 'rules', 'memory', 'enabled', 'updated_at'])
      .execute();
  } catch {
    return {};
  }
  const map: BehaviorMap = {};
  for (const b of rows) map[b.behavior_key] = b;
  return map;
}

function active(map: BehaviorMap, key: string): AiBehaviorRow | undefined {
  const b = map[key];
  return b && b.enabled ? b : undefined;
}

/** Text of an enabled behavior's field, or undefined. */
export function behaviorText(map: BehaviorMap, key: string, field: 'prompt' | 'rules' | 'memory'): string | undefined {
  const v = active(map, key)?.[field];
  return v && v.trim() ? v.trim() : undefined;
}

/** Shared memory/context appended to every customer-facing system prompt. */
export function sharedMemory(map: BehaviorMap): string | undefined {
  return behaviorText(map, 'memory_context', 'memory');
}

/**
 * Compose the customer-service system prompt: persona + reply-language +
 * recommendation rules + the missing-price guardrail + shared memory.
 */
export function customerSystemPrompt(map: BehaviorMap): string | undefined {
  return composeBehaviorContext(map, 'customer_chat').systemPrompt;
}

export function composeBehaviorContext(
  map: BehaviorMap,
  task: AiBehaviorTask,
  extraBehaviorKeys: string[] = [],
): ComposedBehavior {
  if (extraBehaviorKeys.length) {
    throw new Error('extraBehaviorKeys is no longer supported; configure task applicability in prompt-compiler.ts');
  }
  const envelope = compilePrompt(map, LEGACY_TASK_MAP[task], {});
  const included = envelope.contributors.map((c) => {
    const row = map[c.behaviorKey];
    return { key: c.behaviorKey, title: c.title, enabled: true, updated_at: row?.updated_at ?? null, fields: c.fields };
  });
  const toolsAllowed = envelope.toolPolicy;
  const toolInstructions = '';

  return {
    task,
    systemPrompt: envelope.effectiveSystemInstruction,
    behaviorKeys: included.map((b) => b.key),
    includedBehaviors: included,
    disabledBehaviorKeys: envelope.disabledBehaviorKeys,
    toolsAllowed,
    toolInstructions,
    metadata: {
      task,
      behavior_keys: included.map((b) => b.key),
      disabled_behavior_keys: envelope.disabledBehaviorKeys,
      behaviors: included,
      tools_allowed: toolsAllowed,
      prompt_version: envelope.traceId,
      hard_safety: envelope.immutablePolicy.split('\n').slice(1),
    },
  };
}

export function behaviorMetadata(
  context: ComposedBehavior,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...context.metadata,
    ...extra,
  };
}
