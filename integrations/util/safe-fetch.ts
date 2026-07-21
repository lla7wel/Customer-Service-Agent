/**
 * SSRF-safe remote image fetching (EH-019) — the ONLY way server code
 * downloads a remote image.
 *
 *   * https only (http allowed solely for explicit localhost dev);
 *   * DNS resolution is checked against private/reserved ranges BEFORE and
 *     the connected address family re-checked on redirect (each hop);
 *   * bounded size (streamed, aborted past the cap), bounded time;
 *   * content-type must be an image; the magic bytes are verified;
 *   * never throws — returns { ok:false, reason } for the caller to handle.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

const IMAGE_MIME_RE = /^image\/(jpeg|png|webp|gif|bmp|tiff)/i;

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    lower === '::' || lower === '::1' ||
    lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd') ||
    lower.startsWith('::ffff:') // v4-mapped — treat as private unless proven otherwise
  );
}

async function hostResolvesPublic(hostname: string): Promise<boolean> {
  if (isIP(hostname) === 4) return !isPrivateIpv4(hostname);
  if (isIP(hostname) === 6) return !isPrivateIpv6(hostname);
  try {
    const addrs = await lookup(hostname, { all: true });
    if (!addrs.length) return false;
    return addrs.every((a) => (a.family === 4 ? !isPrivateIpv4(a.address) : !isPrivateIpv6(a.address)));
  } catch {
    return false;
  }
}

const MAGIC: { bytes: number[]; offset?: number }[] = [
  { bytes: [0xff, 0xd8, 0xff] },                  // jpeg
  { bytes: [0x89, 0x50, 0x4e, 0x47] },            // png
  { bytes: [0x47, 0x49, 0x46, 0x38] },            // gif
  { bytes: [0x52, 0x49, 0x46, 0x46] },            // riff (webp)
  { bytes: [0x42, 0x4d] },                        // bmp
  { bytes: [0x49, 0x49, 0x2a, 0x00] },            // tiff LE
  { bytes: [0x4d, 0x4d, 0x00, 0x2a] },            // tiff BE
];

function looksLikeImage(buf: Buffer): boolean {
  return MAGIC.some((m) => {
    const off = m.offset ?? 0;
    return buf.length >= off + m.bytes.length && m.bytes.every((b, i) => buf[off + i] === b);
  });
}

export type SafeFetchResult =
  | { ok: true; data: Buffer; contentType: string }
  | { ok: false; reason: string };

export async function fetchImageSafely(rawUrl: string, opts: { maxBytes?: number; timeoutMs?: number } = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES;
  const deadline = Date.now() + (opts.timeoutMs ?? TIMEOUT_MS);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const isLocalDev = process.env.NODE_ENV !== 'production' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalDev)) {
      return { ok: false, reason: 'protocol_not_allowed' };
    }
    if (!isLocalDev && !(await hostResolvesPublic(url.hostname))) {
      return { ok: false, reason: 'private_address_blocked' };
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, reason: 'timeout' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    let res: Response;
    try {
      res = await fetch(url, { redirect: 'manual', signal: controller.signal });
    } catch (e: any) {
      clearTimeout(timer);
      return { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : 'network_error' };
    }

    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const loc = res.headers.get('location');
      if (!loc || hop === MAX_REDIRECTS) return { ok: false, reason: 'too_many_redirects' };
      try {
        url = new URL(loc, url); // re-validated at the top of the next hop
      } catch {
        return { ok: false, reason: 'invalid_redirect' };
      }
      continue;
    }
    if (!res.ok) {
      clearTimeout(timer);
      return { ok: false, reason: `http_${res.status}` };
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!IMAGE_MIME_RE.test(contentType)) {
      clearTimeout(timer);
      res.body?.cancel().catch(() => {});
      return { ok: false, reason: 'not_an_image' };
    }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      clearTimeout(timer);
      res.body?.cancel().catch(() => {});
      return { ok: false, reason: 'too_large' };
    }

    try {
      const reader = res.body?.getReader();
      if (!reader) { clearTimeout(timer); return { ok: false, reason: 'no_body' }; }
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          clearTimeout(timer);
          return { ok: false, reason: 'too_large' };
        }
        chunks.push(value);
      }
      clearTimeout(timer);
      const data = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      if (!looksLikeImage(data)) return { ok: false, reason: 'not_an_image' };
      return { ok: true, data, contentType };
    } catch (e: any) {
      clearTimeout(timer);
      return { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : 'read_error' };
    }
  }
  return { ok: false, reason: 'too_many_redirects' };
}
