import { describe, expect, it } from 'vitest';
import {
  contentConfigFingerprint,
  exactCreativePriceText,
  generationNeedsRetry,
  generationVerificationWarnings,
} from '../../integrations/pipelines/content-create';
import { campaignImageModel, creativeVerificationModel } from '../../integrations/gemini';

const exactIdentityChecks = {
  silhouette_and_geometry: 'match' as const,
  color_material_and_transparency: 'match' as const,
  pattern_artwork_and_labels: 'match' as const,
  included_components_and_count: 'match' as const,
  packaging_and_closures: 'match' as const,
};

describe('content generation configuration', () => {
  it('creates a stable fingerprint for the same generation request', () => {
    const value = {
      purpose: 'general',
      phrase: 'راحة تكمّل بيتك',
      products: [{ id: 'p1', price: 89 }],
      sources: [{ id: 's1', url: 'https://media.example/source.jpg' }],
    };
    expect(contentConfigFingerprint(value)).toBe(contentConfigFingerprint(value));
  });

  it('uses a separate high-accuracy model for final creative verification', () => {
    const previous = process.env.GEMINI_CREATIVE_VERIFICATION_MODEL;
    delete process.env.GEMINI_CREATIVE_VERIFICATION_MODEL;
    try {
      expect(creativeVerificationModel()).toBe('gemini-2.5-pro');
    } finally {
      if (previous === undefined) delete process.env.GEMINI_CREATIVE_VERIFICATION_MODEL;
      else process.env.GEMINI_CREATIVE_VERIFICATION_MODEL = previous;
    }
  });

  it('changes when a publish-critical field changes', () => {
    const base = { purpose: 'general', phrase: 'راحة تكمّل بيتك', price: 89 };
    expect(contentConfigFingerprint(base)).not.toBe(
      contentConfigFingerprint({ ...base, phrase: 'دفا يكمّل بيتك' }),
    );
    expect(contentConfigFingerprint(base)).not.toBe(
      contentConfigFingerprint({ ...base, price: 79 }),
    );
  });

  it('keeps single-product price text concise and associates multiple prices by name', () => {
    expect(exactCreativePriceText([{ name: 'Violet Diffuser', oldPrice: null, newPrice: 69 }]))
      .toEqual(['69 د.ل']);
    expect(exactCreativePriceText([{ name: 'Pillow', oldPrice: 99, newPrice: 79 }]))
      .toEqual(['قبل 99 د.ل — بعد 79 د.ل']);
    expect(exactCreativePriceText([
      { name: 'Pillow', oldPrice: null, newPrice: 99 },
      { name: 'Sheet', oldPrice: null, newPrice: 149 },
    ])).toEqual(['Pillow: 99 د.ل', 'Sheet: 149 د.ل']);
  });

  it('uses the professional image model unless explicitly configured otherwise', () => {
    const previousCampaign = process.env.GEMINI_CAMPAIGN_IMAGE_MODEL;
    delete process.env.GEMINI_CAMPAIGN_IMAGE_MODEL;
    try {
      expect(campaignImageModel()).toBe('gemini-3-pro-image');
    } finally {
      if (previousCampaign === undefined) delete process.env.GEMINI_CAMPAIGN_IMAGE_MODEL;
      else process.env.GEMINI_CAMPAIGN_IMAGE_MODEL = previousCampaign;
    }
  });

  it('retries when product identity, exact Arabic, price, or brand verification fails', () => {
    const base = {
      product_fidelity: 0.96,
      product_status: 'acceptable' as const,
      overlay_text_status: 'likely_exact' as const,
      price_text_status: 'likely_exact' as const,
      brand_mark_status: 'likely_exact' as const,
      observed_text: 'راحة تكمّل بيتك',
      concerns: [],
      identity_checks: exactIdentityChecks,
    };
    expect(generationNeedsRetry(base, true, true, true)).toBe(false);
    expect(generationNeedsRetry({ ...base, overlay_text_status: 'mismatch' }, true, true, true)).toBe(true);
    expect(generationNeedsRetry({ ...base, price_text_status: 'missing' }, true, true, true)).toBe(true);
    expect(generationNeedsRetry({ ...base, product_fidelity: 0.5 }, true, true, true)).toBe(true);
    expect(generationNeedsRetry({ ...base, brand_mark_status: 'mismatch' }, true, true, true)).toBe(true);
    expect(generationNeedsRetry({ ...base, identity_checks: { ...exactIdentityChecks, silhouette_and_geometry: 'mismatch' } }, true, true, true)).toBe(true);
    expect(generationNeedsRetry({ ...base, identity_checks: { ...exactIdentityChecks, included_components_and_count: 'unverifiable' } }, true, true, true)).toBe(true);
    expect(generationNeedsRetry({ ...base, identity_checks: {} as any }, true, true, true)).toBe(true);
  });

  it('never describes an unverified result as exact', () => {
    const warnings = generationVerificationWarnings({
      product_fidelity: 0.91,
      product_status: 'acceptable',
      overlay_text_status: 'mismatch',
      price_text_status: 'unverifiable',
      brand_mark_status: 'unverifiable',
      observed_text: null,
      concerns: [],
      identity_checks: exactIdentityChecks,
    }, true, true);
    expect(warnings).toContain('Arabic image text could not be verified as exact.');
    expect(warnings).toContain('Price text could not be verified as exact.');
    expect(warnings).toContain('Brand mark could not be verified.');
  });
});
