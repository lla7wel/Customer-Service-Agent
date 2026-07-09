/**
 * Perceptual image fingerprinting (dHash) + Hamming distance.
 *
 * Why dHash: this stack has no pgvector / multimodal-embedding API, and the
 * catalog images ARE the English Home Turkey source photos — so a customer who
 * sends a screenshot of a product photo produces a near-identical fingerprint.
 * dHash is deterministic, dependency-light (pure-JS decode via jimp), robust to
 * resize/recolor/compression, and needs no paid API. It is ONE signal among many
 * (code/barcode/URL/keywords/Gemini-vision); if decoding fails it degrades to 0
 * contribution rather than breaking matching.
 *
 * Format: a 64-bit dHash rendered as 16 lowercase hex chars.
 */

/** Compute a 64-bit difference-hash from raw image bytes. Returns null on failure. */
export async function dhashFromBytes(bytes: Buffer | Uint8Array): Promise<string | null> {
  try {
    // Dynamic import keeps jimp lazy + optional. A LITERAL specifier is required
    // so the consumer's bundler (Next) / tsx resolves it from THAT package's
    // node_modules (jimp lives in admin-app/ and scripts/, not in integrations/).
    // @ts-ignore — jimp is resolved by the consumer; no types needed here.
    const mod: any = await import('jimp');
    const Jimp = mod.default ?? mod;
    const img = await Jimp.read(Buffer.from(bytes));
    // 9x8 grayscale → compare each pixel to its right neighbor = 8x8 = 64 bits.
    img.greyscale().resize(9, 8);
    const data: Buffer = img.bitmap.data;
    const w = img.bitmap.width;
    let bits = '';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const left = data[(w * y + x) * 4];
        const right = data[(w * y + (x + 1)) * 4];
        bits += left < right ? '1' : '0';
      }
    }
    return bitsToHex(bits);
  } catch {
    return null;
  }
}

/** Download an image URL and fingerprint it. Returns null on any failure. */
export async function dhashFromUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return dhashFromBytes(buf);
  } catch {
    return null;
  }
}

function bitsToHex(bits: string): string {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex.padStart(16, '0');
}

const POPCOUNT: number[] = Array.from({ length: 16 }, (_, n) =>
  ((n >> 0) & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1),
);

/**
 * Hamming distance between two hex-encoded hashes (0..64). Returns a large
 * number (999) if either is missing/mismatched so callers can treat it as "far".
 */
export function hammingHex(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b || a.length !== b.length) return 999;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = (parseInt(a[i], 16) ^ parseInt(b[i], 16)) & 0xf;
    dist += POPCOUNT[xor];
  }
  return dist;
}

/** Convert a 0..64 Hamming distance to a 0..1 similarity (1 = identical). */
export function hammingSimilarity(distance: number): number {
  if (distance >= 999) return 0;
  return Math.max(0, 1 - distance / 64);
}

/** Thresholds (out of 64 bits) tuned for "same source photo" detection. */
export const NEAR_DUPLICATE_MAX = 8;   // <= this ⇒ almost certainly the same image
export const SIMILAR_MAX = 16;         // <= this ⇒ visually similar, worth ranking
