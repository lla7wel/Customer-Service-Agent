/**
 * Deterministic visual composition for Content Studio.
 *
 * Exact prices and Arabic phrases are NEVER left to an image model to spell.
 * The final text layer is rendered here: an SVG built from verified data,
 * rasterized by resvg (rustybuzz does real Arabic shaping/RTL), composited
 * over the base image with jimp. What the admin previews is exactly what
 * publishes. Fonts: Tajawal (SIL OFL 1.1, bundled in ./fonts).
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { Jimp, JimpMime } from 'jimp';
import { Resvg } from '@resvg/resvg-js';

/**
 * Locate the bundled font directory across every runtime (next dev/build
 * bundles this file, tsx runs it from source, Docker sets FONT_DIR).
 */
function resolveFontDir(): string {
  const candidates = [
    process.env.FONT_DIR,
    path.join(process.cwd(), 'integrations', 'content', 'fonts'),
    path.join(process.cwd(), '..', 'integrations', 'content', 'fonts'),
    typeof __dirname !== 'undefined' ? path.join(__dirname, 'fonts') : undefined,
  ].filter((c): c is string => !!c);
  for (const c of candidates) {
    if (existsSync(path.join(c, 'Tajawal-Bold.ttf'))) return c;
  }
  return candidates[candidates.length - 1] ?? 'fonts';
}
const FONT_DIR = resolveFontDir();

export type AspectPreset = 'feed_square' | 'feed_portrait' | 'story';

export const ASPECT_SIZES: Record<AspectPreset, { width: number; height: number }> = {
  feed_square: { width: 1080, height: 1080 },
  feed_portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

export interface OverlaySpec {
  width: number;
  height: number;
  /** Editable Libyan-Arabic phrase (or null for no text). */
  phrase?: string | null;
  /** Verified price block (price drop: both; general with price: newPrice only). */
  oldPrice?: number | null;
  newPrice?: number | null;
  currency?: string;
  /** Show the brand wordmark line. */
  brandLine?: boolean;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function formatPrice(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Build the overlay SVG. Layout: a soft cream panel anchored at the bottom,
 * Arabic right-aligned, price block prominent. Deterministic — same input,
 * same pixels.
 */
export function buildOverlaySvg(spec: OverlaySpec): string {
  const { width, height } = spec;
  const currency = spec.currency ?? 'د.ل';
  const hasPrices = spec.newPrice != null;
  const hasPhrase = !!spec.phrase?.trim();
  if (!hasPrices && !hasPhrase && !spec.brandLine) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`;
  }

  const lineCount = (hasPhrase ? 1 : 0) + (hasPrices ? 1 : 0)
    + (hasPrices && spec.oldPrice != null && spec.oldPrice > (spec.newPrice ?? 0) ? 1 : 0);
  const panelHeight = Math.round(height * (0.12 + lineCount * 0.065));
  const panelY = height - panelHeight;
  const pad = Math.round(width * 0.055);
  const phraseSize = Math.round(width * 0.05);
  const priceSize = Math.round(width * 0.072);
  const oldPriceSize = Math.round(width * 0.04);
  const brandSize = Math.round(width * 0.024);
  const rightX = width - pad; // Arabic lines END here (right edge, RTL layout)

  let cursorY = panelY + Math.round(panelHeight * 0.18);
  const parts: string[] = [];

  parts.push(`
    <defs>
      <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#faf6ef" stop-opacity="0"/>
        <stop offset="0.25" stop-color="#faf6ef" stop-opacity="0.94"/>
        <stop offset="1" stop-color="#f5efe4" stop-opacity="0.99"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${panelY - Math.round(panelHeight * 0.35)}" width="${width}" height="${panelHeight + Math.round(panelHeight * 0.35)}" fill="url(#panel)"/>
  `);

  // text-anchor="end": each line's RIGHT edge sits at rightX and text extends
  // leftward — correct visual placement for Arabic; rustybuzz shapes the run.
  if (hasPhrase) {
    cursorY += phraseSize;
    parts.push(`
      <text x="${rightX}" y="${cursorY}" text-anchor="end"
            font-family="Tajawal" font-weight="700" font-size="${phraseSize}"
            fill="#2b2320">${esc(spec.phrase!.trim())}</text>
    `);
    cursorY += Math.round(phraseSize * 0.55);
  }

  if (hasPrices) {
    const newP = `${formatPrice(spec.newPrice!)} ${currency}`;
    if (spec.oldPrice != null && spec.oldPrice > (spec.newPrice ?? 0)) {
      const oldP = `${formatPrice(spec.oldPrice)} ${currency}`;
      cursorY += oldPriceSize + Math.round(oldPriceSize * 0.3);
      parts.push(`
        <text x="${rightX}" y="${cursorY}" text-anchor="end"
              font-family="Tajawal" font-weight="400" font-size="${oldPriceSize}"
              fill="#8a7f76" text-decoration="line-through">${esc(oldP)}</text>
      `);
    }
    cursorY += priceSize + Math.round(priceSize * 0.2);
    parts.push(`
      <text x="${rightX}" y="${cursorY}" text-anchor="end"
            font-family="Tajawal" font-weight="700" font-size="${priceSize}"
            fill="${spec.oldPrice != null && spec.oldPrice > (spec.newPrice ?? 0) ? '#b3402e' : '#2b2320'}">${esc(newP)}</text>
    `);
  }

  if (spec.brandLine !== false) {
    parts.push(`
      <text x="${pad}" y="${height - Math.round(pad * 0.6)}" text-anchor="start"
            font-family="Tajawal" font-weight="400" font-size="${brandSize}"
            letter-spacing="2" fill="#6b6058">ENGLISH HOME LIBYA</text>
    `);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('\n')}</svg>`;
}

/** Rasterize an overlay SVG to a transparent PNG (real Arabic shaping). */
export function renderOverlayPng(svg: string, width: number): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: {
      fontDirs: [FONT_DIR],
      defaultFontFamily: 'Tajawal',
      loadSystemFonts: false,
    },
    background: 'rgba(0,0,0,0)',
  });
  return Buffer.from(resvg.render().asPng());
}

export interface ComposeArgs {
  /** Base image (product photo or AI-generated scene). */
  baseImage: Buffer;
  aspect: AspectPreset;
  phrase?: string | null;
  oldPrice?: number | null;
  newPrice?: number | null;
  brandLine?: boolean;
}

/**
 * Compose the final publishable JPEG: base image cover-fitted to the target
 * ratio + the deterministic text overlay.
 */
export async function composeVisual(args: ComposeArgs): Promise<{ jpeg: Buffer; width: number; height: number; overlay: OverlaySpec }> {
  const { width, height } = ASPECT_SIZES[args.aspect];
  const base = await Jimp.read(args.baseImage);
  base.cover({ w: width, h: height });

  const overlaySpec: OverlaySpec = {
    width, height,
    phrase: args.phrase ?? null,
    oldPrice: args.oldPrice ?? null,
    newPrice: args.newPrice ?? null,
    brandLine: args.brandLine !== false,
  };
  const svg = buildOverlaySvg(overlaySpec);
  const overlayPng = renderOverlayPng(svg, width);
  const overlay = await Jimp.read(overlayPng);
  base.composite(overlay, 0, 0);

  const jpeg = await base.getBuffer(JimpMime.jpeg, { quality: 92 });
  return { jpeg, width, height, overlay: overlaySpec };
}
