/**
 * The SINGLE place a customer-facing reply is written.
 *
 * Gemini composes the final AI-Control-governed message,
 * grounded by compiled runtime data and may call controlled read-only product
 * tools for extra lookups.
 *
 * Why this exists: auto-replies used to short-circuit into hard-coded numbered
 * option templates, which felt robotic. Routing every customer message through
 * this helper — the same path the admin "AI suggest" button uses — makes the
 * Messenger pipeline and the AI Playground produce identical, natural replies.
 *
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { chatReplyWithTools, type ProductContext } from '../gemini';
import {
  PRODUCT_TOOL_SCHEMAS, buildProductToolExecutor, newActionRequests,
  type ProductCandidate, type TurnActionRequests,
} from '../tools';
import { productClarifyingQuestion } from '../util/product-display';
import type { BehaviorMap } from '../ai-behaviors';
import { compilePrompt, type AiTask } from '../prompt-compiler';

export interface ComposeReplyArgs {
  behaviors: BehaviorMap;
  task?: Extract<AiTask, 'customer_reply' | 'product_recommendation' | 'handoff_reply'>;
  history?: { role: 'customer' | 'assistant'; text: string }[];
  message: string;
  /** Pre-resolved catalog candidates the reply should be grounded in (max 5). */
  candidates?: ProductCandidate[];
  memoryContext?: string;
  runtimeState?: Record<string, unknown>;
  temperature?: number;
}

export interface ComposedReply {
  text: string;
  model: string | null;
  rounds: number;
  toolCalls: string[];
  /** false only when Gemini is unavailable; a safe clarifying question is returned. */
  ok: boolean;
  promptTraceId: string;
  promptContributors: string[];
  /** Model-requested ACTIONS (images / human attention / order handoff) — the
   *  server validates and decides; the model never acts directly. */
  actions: TurnActionRequests;
}

export async function composeCustomerReply(db: Kysely<DB>, args: ComposeReplyArgs): Promise<ComposedReply> {
  const products: ProductContext[] = (args.candidates ?? []).slice(0, 5).map((c) => ({
    id: c.id, name: c.name, price: c.price, product_code: c.product_code, website_url: c.website_url,
  }));
  const envelope = compilePrompt(args.behaviors, args.task ?? 'customer_reply', {
    customer_message: args.message || 'سلام',
    conversation_history: args.history ?? [],
    customer_memory: args.memoryContext || null,
    verified_catalog_candidates: products,
    turn_state: args.runtimeState ?? {},
  });
  const actions = newActionRequests();
  const reply = await chatReplyWithTools(
    {
      systemPrompt: envelope.effectiveSystemInstruction,
      runtimeData: envelope.runtimeData,
      temperature: args.temperature ?? envelope.generationSettings.temperature,
      maxOutputTokens: envelope.generationSettings.maxOutputTokens,
    },
    PRODUCT_TOOL_SCHEMAS,
    buildProductToolExecutor(db, actions),
  );
  // Gemini unavailable (transient) → a single safe clarifying question, never a
  // robotic product template.
  if (!reply.ok) return { text: productClarifyingQuestion(), model: null, rounds: 0, toolCalls: [], ok: false, promptTraceId: envelope.traceId, promptContributors: envelope.contributors.map((c) => c.behaviorKey), actions };
  const text = reply.text?.trim() || productClarifyingQuestion();
  return { text, model: reply.model, rounds: reply.rounds, toolCalls: reply.toolCalls.map((t) => t.name), ok: true, promptTraceId: envelope.traceId, promptContributors: envelope.contributors.map((c) => c.behaviorKey), actions };
}
