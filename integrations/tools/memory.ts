/**
 * Customer-specific AI memory — per customer, persisted in customer_memory.
 * Lets the AI answer follow-ups naturally ("how much?", "same one", "other
 * colors?", "the one I sent before") and lets admins view/edit/clear it.
 *
 * Best-effort by design: reads return null and writes return ok:false (never
 * throw) on failure — a memory hiccup must not break a customer turn.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import type { ToolResult } from './types';

export interface RecentProduct {
  product_id: string;
  name: string;
  price: number | null;
  resolved_at: string;
  match_type: 'exact' | 'multiple' | 'text' | 'image';
}

export interface CustomerMemory {
  customer_id: string;
  summary: string | null;
  recent_products: RecentProduct[];
  preferences: Record<string, string>;
  known_facts: string[];
  known_name: string | null;
  known_phone: string | null;
  known_address: string | null;
  last_conversation_at: string | null;
  updated_at: string | null;
}

function normalize(row: any): CustomerMemory {
  return {
    customer_id: row.customer_id,
    summary: row.summary ?? null,
    recent_products: Array.isArray(row.recent_products) ? row.recent_products : [],
    preferences: row.preferences && typeof row.preferences === 'object' ? row.preferences : {},
    known_facts: Array.isArray(row.known_facts) ? row.known_facts : [],
    known_name: row.known_name ?? null,
    known_phone: row.known_phone ?? null,
    known_address: row.known_address ?? null,
    last_conversation_at: row.last_conversation_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

/** Read a customer's memory. Returns null if none yet (or on failure). */
export async function getCustomerMemory(db: Kysely<DB>, customerId: string): Promise<CustomerMemory | null> {
  if (!customerId) return null;
  try {
    const data = await db.selectFrom('customer_memory').selectAll().where('customer_id', '=', customerId).executeTakeFirst();
    return data ? normalize(data) : null;
  } catch {
    return null;
  }
}

export interface MemoryPatch {
  summary?: string | null;
  recent_products?: RecentProduct[];
  preferences?: Record<string, string>;
  known_facts?: string[];
  known_name?: string | null;
  known_phone?: string | null;
  known_address?: string | null;
  /** A single product to prepend to recent_products (deduped, capped at 10). */
  addRecentProduct?: RecentProduct;
  touchConversation?: boolean;
}

/** Upsert a customer's memory. Best-effort: returns ok:false (never throws) on failure. */
export async function updateCustomerMemory(db: Kysely<DB>, customerId: string, patch: MemoryPatch): Promise<ToolResult<void>> {
  if (!customerId) return { ok: false, reason: 'no_customer' };
  try {
    const existing = await getCustomerMemory(db, customerId);
    const recent = [...(patch.recent_products ?? existing?.recent_products ?? [])];
    if (patch.addRecentProduct) {
      const without = recent.filter((r) => r.product_id !== patch.addRecentProduct!.product_id);
      without.unshift(patch.addRecentProduct);
      recent.length = 0;
      recent.push(...without.slice(0, 10));
    }
    const row: Record<string, unknown> = {
      customer_id: customerId,
      updated_at: new Date().toISOString(),
      recent_products: JSON.stringify(recent),
    };
    if (patch.summary !== undefined) row.summary = patch.summary;
    if (patch.preferences !== undefined) row.preferences = JSON.stringify(patch.preferences);
    if (patch.known_facts !== undefined) row.known_facts = patch.known_facts;
    if (patch.known_name !== undefined) row.known_name = patch.known_name;
    if (patch.known_phone !== undefined) row.known_phone = patch.known_phone;
    if (patch.known_address !== undefined) row.known_address = patch.known_address;
    if (patch.touchConversation) row.last_conversation_at = new Date().toISOString();
    await db
      .insertInto('customer_memory')
      .values(row as any)
      .onConflict((oc) => oc.column('customer_id').doUpdateSet(row as any))
      .execute();
    return { ok: true, data: undefined };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'memory_update_failed' };
  }
}

/** Clear (delete) a customer's memory. */
export async function clearCustomerMemory(db: Kysely<DB>, customerId: string): Promise<ToolResult<void>> {
  try {
    await db.deleteFrom('customer_memory').where('customer_id', '=', customerId).execute();
    return { ok: true, data: undefined };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'memory_clear_failed' };
  }
}

/**
 * Format memory as an internal context block injected into the AI prompt. Empty
 * string when there is nothing useful, so prompts stay clean for new customers.
 */
export function buildMemoryContext(memory: CustomerMemory | null): string {
  if (!memory) return '';
  const lines: string[] = [];
  if (memory.known_name) lines.push(`Customer name: ${memory.known_name}`);
  if (memory.known_phone) lines.push(`Phone: ${memory.known_phone}`);
  if (memory.known_address) lines.push(`Address: ${memory.known_address}`);
  if (memory.summary) lines.push(`Summary: ${memory.summary}`);
  if (memory.preferences && Object.keys(memory.preferences).length) {
    lines.push('Preferences: ' + Object.entries(memory.preferences).map(([k, v]) => `${k}=${v}`).join(', '));
  }
  if (memory.known_facts?.length) lines.push('Known facts: ' + memory.known_facts.slice(0, 8).join('; '));
  if (memory.recent_products?.length) {
    lines.push(
      'Recently discussed products (most recent first): ' +
      memory.recent_products.slice(0, 5)
        .map((p) => `${p.name}${p.price != null ? ` (${p.price} LYD)` : ''}`)
        .join(' | '),
    );
  }
  if (!lines.length) return '';
  return `[CUSTOMER MEMORY — what you already know about this customer; use it to answer follow-ups like "how much" or "the one I sent before". Do not repeat it back verbatim.]\n${lines.join('\n')}`;
}
