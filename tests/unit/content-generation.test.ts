import { describe, expect, it } from 'vitest';
import {
  contentConfigFingerprint,
  generationNeedsRetry,
  generationVerificationWarnings,
} from '../../integrations/pipelines/content-create';
import { campaignImageModel } from '../../integrations/gemini';

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

  it('changes when a publish-critical field changes', () => {
    const base = { purpose: 'general', phrase: 'راحة تكمّل بيتك', price: 89 };
    expect(contentConfigFingerprint(base)).not.toBe(
      contentConfigFingerprint({ ...base, phrase: 'دفا يكمّل بيتك' }),
    );
    expect(contentConfigFingerprint(base)).not.toBe(
      contentConfigFingerprint({ ...base, price: 79 }),
    );
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
    };
    expect(generationNeedsRetry(base, true, true, true)).toBe(false);
    expect(generationNeedsRetry({ ...base, overlay_text_status: 'mismatch' }, true, true, true)).toBe(true);
    expect(generationNeedsRetry({ ...base, price_text_status: 'missing' }, true, true, true)).toBe(true);
    expect(generationNeedsRetry({ ...base, product_fidelity: 0.5 }, true, true, true)).toBe(true);
    expect(generationNeedsRetry({ ...base, brand_mark_status: 'mismatch' }, true, true, true)).toBe(true);
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
    }, true, true);
    expect(warnings).toContain('Arabic image text could not be verified as exact.');
    expect(warnings).toContain('Price text could not be verified as exact.');
    expect(warnings).toContain('Brand mark could not be verified.');
  });
});
