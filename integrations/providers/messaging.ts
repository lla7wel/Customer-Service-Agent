/**
 * Direct-message adapters: Facebook Messenger + Instagram Direct.
 *
 * Both channels ride the Messenger Platform send API with the Page token; the
 * recipient id namespace differs (PSID vs IGSID). Callers never talk to Graph
 * directly — the outbox delivery job is the only send path, and it passes an
 * idempotency context so ambiguous outcomes can be reconciled instead of
 * duplicated.
 */
import { graphCall } from './graph';

export type DmChannel = 'messenger' | 'instagram';

export interface SendResult {
  providerMessageId: string | null;
  recipientId: string | null;
}

/** Send a text DM. NO internal retries: delivery retries are outbox-owned. */
export async function sendDmText(channel: DmChannel, recipientId: string, text: string): Promise<SendResult> {
  const res = await graphCall<{ message_id?: string; recipient_id?: string }>('me/messages', {
    method: 'POST',
    retries: 0,
    params: {
      recipient: { id: recipientId },
      messaging_type: 'RESPONSE',
      message: { text },
    },
  });
  return { providerMessageId: res.message_id ?? null, recipientId: res.recipient_id ?? null };
}

/** Send an image DM from a public HTTPS URL (Meta fetches it server-side). */
export async function sendDmImage(channel: DmChannel, recipientId: string, imageUrl: string): Promise<SendResult> {
  const res = await graphCall<{ message_id?: string; recipient_id?: string }>('me/messages', {
    method: 'POST',
    retries: 0,
    params: {
      recipient: { id: recipientId },
      messaging_type: 'RESPONSE',
      message: { attachment: { type: 'image', payload: { url: imageUrl, is_reusable: true } } },
    },
  });
  return { providerMessageId: res.message_id ?? null, recipientId: res.recipient_id ?? null };
}

/** Fetch a user's profile (name/avatar) for the inbox. Works for PSID + IGSID. */
export async function getDmProfile(userId: string): Promise<{ first_name?: string; last_name?: string; name?: string; profile_pic?: string } | null> {
  try {
    return await graphCall(`${userId}`, {
      params: { fields: 'first_name,last_name,name,profile_pic' },
      retries: 1,
    });
  } catch {
    return null; // profile may be unavailable (permissions/deleted) — not fatal
  }
}
