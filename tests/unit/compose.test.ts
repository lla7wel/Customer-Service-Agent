import { describe, expect, it } from 'vitest';
import { Jimp, JimpMime } from 'jimp';
import { buildOverlaySvg, renderOverlayPng, composeVisual, formatPrice } from '../../integrations/content/compose';
import { familyKeyFromName, variantLabelFromName } from '../../integrations/catalog/families';

describe('deterministic price/typography overlay', () => {
  it('renders exact verified prices into the SVG — never model-spelled', () => {
    const svg = buildOverlaySvg({ width: 1080, height: 1080, phrase: 'دفء يليق ببيتك', oldPrice: 250, newPrice: 189 });
    expect(svg).toContain('189 د.ل');
    expect(svg).toContain('250 د.ل');
    expect(svg).toContain('line-through');
  });

  it('is deterministic (same input → same SVG)', () => {
    const a = buildOverlaySvg({ width: 1080, height: 1080, phrase: 'عبارة', newPrice: 99 });
    const b = buildOverlaySvg({ width: 1080, height: 1080, phrase: 'عبارة', newPrice: 99 });
    expect(a).toBe(b);
  });

  it('escapes markup in the phrase', () => {
    const svg = buildOverlaySvg({ width: 1080, height: 1080, phrase: '<script>alert(1)</script>' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('rasterizes Arabic with the bundled font (non-empty PNG)', () => {
    const svg = buildOverlaySvg({ width: 540, height: 540, phrase: 'أطقم أغطية قطن', newPrice: 149 });
    const png = renderOverlayPng(svg, 540);
    expect(png.length).toBeGreaterThan(2000);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });

  it('composes a full 9:16 story JPEG from a base image', async () => {
    const base = await new Jimp({ width: 200, height: 200, color: 0xd9cbb8ff }).getBuffer(JimpMime.jpeg, { quality: 90 });
    const out = await composeVisual({ baseImage: base, aspect: 'story', phrase: 'ستوري', newPrice: 120 });
    expect(out.width).toBe(1080);
    expect(out.height).toBe(1920);
    expect(out.jpeg[0]).toBe(0xff); // JPEG SOI
  });

  it('formats prices without float noise', () => {
    expect(formatPrice(189)).toBe('189');
    expect(formatPrice(189.5)).toBe('189.50');
  });
});

describe('family grouping heuristics', () => {
  it('groups genuine size/color variations under one base', () => {
    const a = familyKeyFromName('RANFORCE DUVET COVER SET 160x220 WHITE');
    const b = familyKeyFromName('RANFORCE DUVET COVER SET 200x220 GREY');
    expect(a).toBe(b);
    expect(a).toContain('duvet cover set');
  });

  it('does not merge unrelated products', () => {
    const a = familyKeyFromName('COTTON BATH TOWEL 70x140');
    const b = familyKeyFromName('RANFORCE DUVET COVER SET 160x220');
    expect(a).not.toBe(b);
  });

  it('extracts the stripped tokens as the variant label', () => {
    const label = variantLabelFromName('RANFORCE DUVET COVER SET 160x220 WHITE');
    expect(label).toContain('160x220');
    expect(label.toLowerCase()).toContain('white');
  });

  it('returns empty key for names too short to group safely', () => {
    expect(familyKeyFromName('SET')).toBe('');
  });
});
