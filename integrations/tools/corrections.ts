/**
 * Admin image-correction learning loop. When an admin confirms the correct
 * product for a customer image, we (1) store the correction and (2) save the
 * customer image's dHash as a product_fingerprint so future near-identical
 * images match instantly — the same mistake gets less likely over time.
 *
 * The product_fingerprints write is best-effort: a failure there must not
 * lose the correction itself.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import type { ToolResult } from './types';

export interface SaveCorrectionInput {
  conversationId?: string | null;
  messageId?: string | null;
  correctionId?: string | null;     // update this row if given, else insert
  correctedProductId: string;
  customerImageUrl?: string | null;
  customerImageHash?: string | null;
  notes?: string | null;
}

/** Persist an admin correction and feed the fingerprint back into matching. */
export async function saveImageCorrection(db: Kysely<DB>, input: SaveCorrectionInput): Promise<ToolResult<{ learned: boolean }>> {
  try {
    let correctionId = input.correctionId ?? null;
    const base = {
      corrected_product_id: input.correctedProductId,
      outcome: 'corrected' as const,
      customer_image_hash: input.customerImageHash ?? null,
      customer_image_url: input.customerImageUrl ?? null,
      ...(input.notes ? { notes: input.notes.slice(0, 500) } : {}),
    };
    if (correctionId) {
      await db.updateTable('image_match_corrections').set(base).where('id', '=', correctionId).execute();
    } else {
      const data = await db
        .insertInto('image_match_corrections')
        .values({
          conversation_id: input.conversationId ?? null,
          message_id: input.messageId ?? null,
          ...base,
        })
        .returning('id')
        .executeTakeFirst();
      correctionId = data?.id ?? null;
    }

    // Feed the fingerprint back so future image matching learns from it.
    let learned = false;
    if (input.customerImageHash) {
      try {
        await db
          .insertInto('product_fingerprints')
          .values({
            product_id: input.correctedProductId,
            hash_hex: input.customerImageHash,
            source: 'admin_correction',
            correction_id: correctionId,
          })
          .execute();
        learned = true;
      } catch {
        // best-effort — the correction row above is already saved
      }
    }
    return { ok: true, data: { learned } };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? 'save_correction_failed' };
  }
}
