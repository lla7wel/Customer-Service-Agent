import type { BehaviorMap } from '../ai-behaviors';
import { compilePrompt } from '../prompt-compiler';
import { editImage, verifyCampaignImage, type CampaignImageVerification } from '../gemini';

export interface CampaignCreativeInput {
  behaviors: BehaviorMap;
  sourceImageBase64: string;
  sourceMimeType: string;
  objective: string;
  caption: string;
  imageText: string;
  aspectRatio: string;
  targetChannel: string;
  products: Array<{ id: string; name: string; product_code?: string | null; category?: string | null }>;
  retryFeedback?: string[];
}

export interface CampaignCreativeResult {
  image: { mimeType: string; data: string };
  model: string;
  requestedModel: string;
  fallbackUsed: boolean;
  attempts: { model: string; ok: boolean; error?: string }[];
  promptTraceId: string;
  contributors: string[];
  verification: CampaignImageVerification;
  verificationModel: string | null;
  regeneratedForFidelity: boolean;
}

function runtime(input: CampaignCreativeInput, retryFeedback?: string[]) {
  return {
    campaign: {
      objective: input.objective || null,
      post_caption: input.caption || null,
      exact_image_text: input.imageText || null,
      aspect_ratio: input.aspectRatio || '1:1',
      target_channel: input.targetChannel || 'facebook_instagram',
    },
    verified_products: input.products,
    source_image: {
      supplied: true,
      role: 'identity reference for the product that must be preserved',
    },
    retry_feedback: retryFeedback?.length ? retryFeedback : undefined,
  };
}

async function generateOnce(input: CampaignCreativeInput, retryFeedback?: string[]) {
  const envelope = compilePrompt(input.behaviors, 'campaign_image', runtime(input, retryFeedback));
  const generated = await editImage({
    systemPrompt: envelope.effectiveSystemInstruction,
    prompt: envelope.runtimeData,
    baseImageBase64: input.sourceImageBase64,
    mimeType: input.sourceMimeType,
    temperature: envelope.generationSettings.temperature,
  });
  if (!generated.ok) throw new Error(`AI image generation unavailable: ${generated.missing.join(', ')}`);
  const image = generated.images[0];
  if (!image) throw new Error('Image model returned no image.');

  const verifyEnvelope = compilePrompt(input.behaviors, 'campaign_image_verify', {
    requested_overlay_text: input.imageText || null,
    verified_products: input.products,
    comparison: 'Compare source product identity with generated campaign image and inspect requested overlay text.',
  });
  const checked = await verifyCampaignImage({
    systemPrompt: verifyEnvelope.effectiveSystemInstruction,
    runtimeData: verifyEnvelope.runtimeData,
    sourceImageBase64: input.sourceImageBase64,
    sourceMimeType: input.sourceMimeType,
    generatedImageBase64: image.data,
    generatedMimeType: image.mimeType,
    temperature: verifyEnvelope.generationSettings.temperature,
  });
  const verification: CampaignImageVerification = checked.ok ? checked.result : {
    product_fidelity: 0,
    product_status: 'unverifiable',
    overlay_text_status: input.imageText ? 'unverifiable' : 'not_requested',
    observed_text: null,
    concerns: ['Verification model unavailable. Human review is required.'],
  };
  return {
    image,
    generated,
    envelope,
    verification,
    verificationModel: checked.ok ? checked.model : null,
  };
}

/** Shared by campaign production and Playground. Human approval remains mandatory. */
export async function generateCampaignCreative(input: CampaignCreativeInput): Promise<CampaignCreativeResult> {
  let run = await generateOnce(input, input.retryFeedback);
  let regeneratedForFidelity = false;
  if (run.verification.product_status === 'unacceptable' || run.verification.product_fidelity < 0.45) {
    regeneratedForFidelity = true;
    run = await generateOnce(input, [
      'The previous result failed product-fidelity review.',
      ...run.verification.concerns,
      'Preserve the supplied product more faithfully and generate the environment around it.',
    ]);
  }
  return {
    image: run.image,
    model: run.generated.model,
    requestedModel: run.generated.requestedModel,
    fallbackUsed: run.generated.fallbackUsed,
    attempts: run.generated.attempts,
    promptTraceId: run.envelope.traceId,
    contributors: run.envelope.contributors.map((c) => c.behaviorKey),
    verification: run.verification,
    verificationModel: run.verificationModel,
    regeneratedForFidelity,
  };
}
