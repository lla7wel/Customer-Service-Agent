/** Portable base64 helpers (work in Node, Next.js and Cloudflare Workers). */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // btoa exists in Workers and modern Node (global).
  if (typeof btoa === 'function') return btoa(binary);
  // Node fallback.
  return Buffer.from(bytes).toString('base64');
}

export async function fetchImageBase64(
  url: string,
): Promise<{ data: string; mimeType: string } | null> {
  const result = await fetchImageBase64Detailed(url);
  return result.ok && result.data ? { data: result.data, mimeType: result.mimeType || 'image/jpeg' } : null;
}

export interface FetchImageBase64Diagnostic {
  ok: boolean;
  data?: string;
  mimeType?: string;
  status?: number;
  bytesSize?: number;
  error?: string;
}

/** Hard cap so a huge image can't blow up Gemini cost/latency (12 MB). */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * SSRF-safe remote image download → base64 (EH-019). All protocol/DNS/private
 * -range/redirect/size/MIME/magic-byte enforcement lives in util/safe-fetch;
 * this wrapper keeps the diagnostic shape the pipelines already consume.
 */
export async function fetchImageBase64Detailed(url: string, timeoutMs = 10_000): Promise<FetchImageBase64Diagnostic> {
  const { fetchImageSafely } = await import('./safe-fetch');
  const result = await fetchImageSafely(url, { maxBytes: MAX_IMAGE_BYTES, timeoutMs });
  if (!result.ok) return { ok: false, error: result.reason };
  return {
    ok: true,
    data: result.data.toString('base64'),
    mimeType: result.contentType || 'image/jpeg',
    bytesSize: result.data.byteLength,
  };
}
