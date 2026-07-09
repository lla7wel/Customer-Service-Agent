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

/** Hard cap so a huge image can't blow up Gemini cost/latency (20 MB). */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function fetchImageBase64Detailed(url: string, timeoutMs = 8000): Promise<FetchImageBase64Diagnostic> {
  // Abort a slow image download so it never blocks the whole agent turn.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, status: res.status };
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, status: res.status, bytesSize: buf.byteLength, error: 'image_too_large' };
    }
    return { ok: true, data: arrayBufferToBase64(buf), mimeType, status: res.status, bytesSize: buf.byteLength };
  } catch (e: any) {
    return { ok: false, error: e?.name === 'AbortError' ? 'image_download_timeout' : (e?.message ?? 'image_download_failed') };
  } finally {
    clearTimeout(timer);
  }
}
