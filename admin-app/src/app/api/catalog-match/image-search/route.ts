/**
 * Catalog Review image search — admin uploads an image (or passes a scraper
 * image URL) and gets matching CATALOG products via the SAME canonical resolver
 * / image pipeline the customer side uses. Read-only: it does not approve or
 * attach anything; the admin picks a result and approves via the normal flow.
 *
 * Body: { image?: {data,mime}, imageUrl?: string, limit?: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@integrations/supabase/admin-client';
import { supabaseStatus, geminiStatus } from '@integrations/status';
import { resolveProducts } from '@integrations/pipelines/resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const db = adminClient();
  if (!db) {
    return NextResponse.json(
      { error: 'integration_not_configured', missing: supabaseStatus().missing.concat('SUPABASE_SERVICE_ROLE_KEY') },
      { status: 503 },
    );
  }
  if (!geminiStatus().configured) {
    return NextResponse.json({ error: 'integration_not_configured', integration: 'gemini', missing: ['GEMINI_API_KEY'] }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const dataUrl = String(body?.image?.data ?? '');
  const mime = String(body?.image?.mime ?? 'image/jpeg');
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const imageUrl = typeof body?.imageUrl === 'string' && body.imageUrl ? body.imageUrl : null;
  if (!base64 && !imageUrl) return NextResponse.json({ error: 'no_image' }, { status: 400 });
  const limit = Math.min(12, Math.max(1, parseInt(String(body?.limit ?? 8), 10) || 8));

  try {
    const result = await resolveProducts(db, {
      imageBase64: base64 || undefined,
      imageUrl: imageUrl || undefined,
      mimeType: mime,
      mode: 'admin',
      limit,
    });
    return NextResponse.json({
      ok: true,
      outcome: result.outcome,
      candidates: result.candidates,
      debug: { source: result.source, diagnostics: result.diagnostics, timing_ms: result.timingMs },
    });
  } catch (e: any) {
    const msg = e?.message ?? 'server_error';
    const isTimeout = e?.timeout || e?.status === 504 || /timed out/i.test(msg);
    return NextResponse.json(
      { error: msg, timeout: !!isTimeout },
      { status: isTimeout ? 504 : 500 },
    );
  }
}
