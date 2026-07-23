/**
 * Meta / Facebook integration — Graph API client + webhook verification.
 * Portable across runtimes (fetch + Web Crypto only). Centralizes Messenger
 * send and page posting.
 */
import { metaStatus } from '../status';
// Credentials resolve through the shared (DB-first, env-fallback) getters so the
// legacy module and the hardened provider client use the SAME connection.
import {
  graphBase, pageAccessToken as pageToken, pageId, appSecret, verifyToken as resolvedVerifyToken,
} from '../providers/graph';

export function isMetaConfigured(): boolean {
  return metaStatus().configured;
}

export class MetaNotConfiguredError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`Meta is not configured. Missing: ${missing.join(', ')}. See docs/ENV.md.`);
    this.name = 'MetaNotConfiguredError';
    this.missing = missing;
  }
}

/* -------------------------------------------------------------------------- */
/* Webhook verification                                                       */
/* -------------------------------------------------------------------------- */

/** GET handshake: echo hub.challenge if the verify token matches. */
export function verifySubscription(params: URLSearchParams): { ok: boolean; challenge?: string } {
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge') || undefined;
  const expected = resolvedVerifyToken();
  if (mode === 'subscribe' && expected && token === expected) {
    return { ok: true, challenge };
  }
  return { ok: false };
}

/** Verify X-Hub-Signature-256 (HMAC-SHA256 of the RAW body with the app secret). */
export async function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  const secret = appSecret();
  if (!secret || !signatureHeader) return false;
  const provided = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice('sha256='.length)
    : signatureHeader;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, provided);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/* -------------------------------------------------------------------------- */
/* Graph API actions                                                          */
/* -------------------------------------------------------------------------- */

async function graph(path: string, init: Omit<RequestInit, 'body'> & { body?: any }): Promise<any> {
  const token = pageToken();
  if (!token) throw new MetaNotConfiguredError(['META_PAGE_ACCESS_TOKEN']);
  const url = `${graphBase()}/${path}`;
  // The access token travels in the Authorization header — NEVER in the URL, so
  // it can never leak into request logs (audit finding #10).
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers || {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as any)?.error?.message || `Meta Graph HTTP ${res.status}`;
    const err = new Error(msg);
    (err as any).status = res.status;
    (err as any).response = data;
    throw err;
  }
  return data;
}

/** Send a Messenger text message to a PSID (requires standard messaging access). */
export async function sendMessage(recipientPsid: string, text: string): Promise<{ message_id?: string }> {
  return graph('me/messages', {
    method: 'POST',
    body: {
      recipient: { id: recipientPsid },
      messaging_type: 'RESPONSE',
      message: { text },
    },
  });
}

/**
 * Send a Messenger image attachment to a PSID. The URL must be a public HTTPS
 * URL (Meta fetches it server-side). `is_reusable` lets Meta cache it so the
 * same product photo isn't re-uploaded on every send. Callers must pre-validate
 * the URL (see isMetaSafeImageUrl in pipelines/product-image).
 */
export async function sendImageMessage(recipientPsid: string, imageUrl: string): Promise<{ message_id?: string }> {
  return graph('me/messages', {
    method: 'POST',
    body: {
      recipient: { id: recipientPsid },
      messaging_type: 'RESPONSE',
      message: { attachment: { type: 'image', payload: { url: imageUrl, is_reusable: true } } },
    },
  });
}

/** Publish a single photo post to the Page (optionally scheduled). */
export async function publishPhoto(args: {
  imageUrl: string;
  caption?: string;
  scheduledUnix?: number; // if set, schedules instead of publishing now
}): Promise<{ id?: string; post_id?: string }> {
  const id = pageId();
  if (!id) throw new MetaNotConfiguredError(['META_PAGE_ID']);
  const body: Record<string, unknown> = {
    url: args.imageUrl,
    caption: args.caption,
  };
  if (args.scheduledUnix) {
    body.published = false;
    body.scheduled_publish_time = args.scheduledUnix;
  }
  return graph(`${id}/photos`, { method: 'POST', body });
}

/**
 * Publish a carousel (multi-photo) post: upload each photo unpublished, then
 * create a feed post referencing the attached media.
 */
export async function publishCarousel(args: {
  imageUrls: string[];
  caption?: string;
  scheduledUnix?: number;
}): Promise<{ id?: string }> {
  const id = pageId();
  if (!id) throw new MetaNotConfiguredError(['META_PAGE_ID']);
  const mediaFbids: string[] = [];
  for (const url of args.imageUrls) {
    const uploaded = await graph(`${id}/photos`, {
      method: 'POST',
      body: { url, published: false },
    });
    if (uploaded?.id) mediaFbids.push(uploaded.id);
  }
  const body: Record<string, unknown> = {
    message: args.caption,
    attached_media: mediaFbids.map((m) => ({ media_fbid: m })),
  };
  if (args.scheduledUnix) {
    body.published = false;
    body.scheduled_publish_time = args.scheduledUnix;
  }
  return graph(`${id}/feed`, { method: 'POST', body });
}

/** Fetch the Page profile of a Messenger user (name, pic) for the inbox. */
export async function getUserProfile(psid: string): Promise<any> {
  return graph(`${psid}?fields=first_name,last_name,profile_pic`, {
    method: 'GET',
  });
}

/* -------------------------------------------------------------------------- */
/* Webhook payload typing (minimal)                                           */
/* -------------------------------------------------------------------------- */

export interface MessengerEvent {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    attachments?: { type: string; payload: { url?: string } }[];
    // Reply to a Facebook/Instagram story the customer saw — carries the story
    // media URL, which we treat as the product image for matching.
    reply_to?: { story?: { url?: string; id?: string }; mid?: string };
  };
  postback?: { title?: string; payload?: string };
  // Story mention / ad / m.me referral context.
  referral?: { ref?: string; source?: string; type?: string; ad_id?: string };
}

/** Normalize a Messenger webhook body into a flat list of events. */
export function parseMessengerWebhook(body: any): MessengerEvent[] {
  const out: MessengerEvent[] = [];
  for (const entry of body?.entry ?? []) {
    for (const ev of entry?.messaging ?? []) out.push(ev as MessengerEvent);
  }
  return out;
}
