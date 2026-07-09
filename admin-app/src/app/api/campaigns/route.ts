/**
 * Campaign list and create — GET returns all campaigns, POST creates a new one.
 * Called by: campaigns list page, CampaignBuilder component.
 * See [campaignId]/route.ts for per-campaign CRUD, publish, and asset management.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@integrations/supabase/admin-client';
import { supabaseStatus } from '@integrations/status';

export const runtime = 'nodejs';

const FIELDS = [
  'name', 'type', 'discount_percent', 'starts_at', 'ends_at', 'priority',
  'caption_tone', 'design_prompt', 'caption_prompt',
  'publish_mode', 'scheduled_for', 'auto_publish',
];

/** Create a draft campaign. */
export async function POST(req: NextRequest) {
  const db = adminClient();
  if (!db) {
    return NextResponse.json(
      { error: 'integration_not_configured', missing: supabaseStatus().missing.concat('SUPABASE_SERVICE_ROLE_KEY') },
      { status: 503 },
    );
  }
  const body = await req.json().catch(() => ({}));
  if (!body?.name?.trim()) return NextResponse.json({ error: 'name_required' }, { status: 400 });

  const row: Record<string, unknown> = { status: 'draft' };
  for (const k of FIELDS) if (k in body) row[k] = body[k];

  const { data, error } = await db.from('campaigns').insert(row).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from('activity_logs').insert({
    actor_type: 'human',
    action: 'campaign_created',
    entity_type: 'campaign',
    entity_id: data.id,
    summary: body.name,
  });

  return NextResponse.json({ ok: true, id: data.id });
}
