/**
 * The SINGLE place a customer-facing reply is written.
 *
 * Gemini composes the final Libyan-Arabic message (temperature 0.7 by default),
 * grounded by any pre-resolved catalog candidates plus an internal "situation"
 * note, and may call the controlled read-only product tools for extra lookups.
 *
 * Why this exists: auto-replies used to short-circuit into hard-coded numbered
 * option templates, which felt robotic. Routing every customer message through
 * this helper — the same path the admin "AI suggest" button uses — makes the
 * Messenger pipeline and the AI Playground produce identical, natural replies.
 *
 * The situation note is INTERNAL guidance for the model, never shown verbatim.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { chatReplyWithTools, type ProductContext } from '../gemini';
import { PRODUCT_TOOL_SCHEMAS, buildProductToolExecutor, type ProductCandidate } from '../tools';
import { productClarifyingQuestion } from '../util/product-display';

export interface ComposeReplyArgs {
  systemPrompt: string;
  history?: { role: 'customer' | 'assistant'; text: string }[];
  message: string;
  /** Pre-resolved catalog candidates the reply should be grounded in (max 5). */
  candidates?: ProductCandidate[];
  /** Internal situation/memory note — guidance for the model, never shown raw. */
  contextNote?: string;
  temperature?: number;
}

export interface ComposedReply {
  text: string;
  model: string | null;
  rounds: number;
  toolCalls: string[];
  /** false only when Gemini is unavailable; a safe clarifying question is returned. */
  ok: boolean;
}

/** Merge the per-customer memory note with a per-turn situation note. */
export function situationNote(memoryContext?: string, situation?: string): string | undefined {
  const parts = [memoryContext?.trim(), situation?.trim()].filter(Boolean);
  return parts.length ? parts.join('\n\n') : undefined;
}

export async function composeCustomerReply(db: SupabaseClient, args: ComposeReplyArgs): Promise<ComposedReply> {
  const products: ProductContext[] = (args.candidates ?? []).slice(0, 5).map((c) => ({
    id: c.id, name: c.name, price: c.price, product_code: c.product_code, website_url: c.website_url,
  }));
  const reply = await chatReplyWithTools(
    {
      systemPrompt: args.systemPrompt,
      history: args.history,
      message: args.message || 'سلام',
      products,
      contextNote: args.contextNote,
      temperature: args.temperature ?? 0.7,
    },
    PRODUCT_TOOL_SCHEMAS,
    buildProductToolExecutor(db),
  );
  // Gemini unavailable (transient) → a single safe clarifying question, never a
  // robotic product template.
  if (!reply.ok) return { text: productClarifyingQuestion(), model: null, rounds: 0, toolCalls: [], ok: false };
  const text = reply.text?.trim() || productClarifyingQuestion();
  return { text, model: reply.model, rounds: reply.rounds, toolCalls: reply.toolCalls.map((t) => t.name), ok: true };
}
