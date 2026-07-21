/**
 * Structured, editable Business Facts (branches, hours, contacts, delivery)
 * — stored in the business_facts table, edited in Settings, seeded by
 * migration 0017. The prompt compiler injects them as verified runtime data;
 * they are never buried in prompt prose.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';

export interface BusinessFacts {
  branches: string[];
  workingHours: string | null;
  phone: string | null;
  deliveryAvailable: boolean;
  pickupAvailable: boolean;
  orderWhatsappUrl: string | null;
  orderWhatsappBenghazi: string | null;
  /** Raw map for the Settings editor. */
  raw: Record<string, unknown>;
}

export async function loadBusinessFacts(db: Kysely<DB>): Promise<BusinessFacts> {
  const rows = await db.selectFrom('business_facts').select(['key', 'value']).execute();
  const map: Record<string, unknown> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    branches: Array.isArray(map.branches) ? (map.branches as string[]) : [],
    workingHours: typeof map.working_hours === 'string' ? map.working_hours : null,
    phone: typeof map.phone === 'string' ? map.phone : null,
    deliveryAvailable: map.delivery_available === true,
    pickupAvailable: map.pickup_available === true,
    orderWhatsappUrl: typeof map.order_whatsapp_url === 'string' ? map.order_whatsapp_url : null,
    orderWhatsappBenghazi: typeof map.order_whatsapp_benghazi === 'string' ? map.order_whatsapp_benghazi : null,
    raw: map,
  };
}

/** Runtime-data payload for the prompt compiler (verified facts only). */
export function businessFactsRuntime(facts: BusinessFacts): Record<string, unknown> {
  return {
    branches: facts.branches,
    working_hours: facts.workingHours,
    phone: facts.phone,
    delivery_available: facts.deliveryAvailable,
    pickup_available: facts.pickupAvailable,
  };
}

/**
 * The single order-handoff message. Deterministic (not LLM-written) so it can
 * never drift into collecting order details or confirming an order. Contacts
 * come from editable Business Facts.
 */
export function buildOrderHandoffMessage(facts: BusinessFacts): string {
  const lines = ['تمام، الفريق بيكمل معاك في الطلب 🤍'];
  if (facts.orderWhatsappUrl) lines.push(`وتقدر تطلب مباشرة على واتساب: ${facts.orderWhatsappUrl}`);
  if (facts.orderWhatsappBenghazi) lines.push(`واتساب فرع بنغازي: ${facts.orderWhatsappBenghazi}`);
  lines.push('ولو عندك سؤال على المقاس أو اللون أو المنتج، أنا معاك.');
  return lines.join('\n');
}
