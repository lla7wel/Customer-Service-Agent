/**
 * Campaign list and create — GET returns all campaigns, POST creates a new one.
 * Called by: campaigns list page, CampaignBuilder component.
 * See [campaignId]/route.ts for per-campaign CRUD, publish, and asset management.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@integrations/db/client';
import { databaseStatus } from '@integrations/status';

export const runtime = 'nodejs';

const FIELDS = [
  'name', 'type', 'discount_percent', 'starts_at', 'ends_at', 'priority',
  'caption_tone', 'design_prompt', 'caption_prompt',
  'publish_mode', 'scheduled_for', 'auto_publish',
];

/** Create a draft campaign. */
export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'integration_not_configured', missing: databaseStatus().missing },
      { status: 503 },
    );
  }
  const body = await req.json().catch(() => ({}));
  if (!body?.name?.trim()) return NextResponse.json({ error: 'name_required' }, { status: 400 });

  const row: Record<string, unknown> = { status: 'draft' };
  for (const k of FIELDS) if (k in body) row[k] = body[k];

  let data: { id: string };
  try {
    data = await db.insertInto('campaigns').values(row as any).returning('id').executeTakeFirstOrThrow();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'insert_failed' }, { status: 500 });
  }

  await db.insertInto('activity_logs').values({
    actor_type: 'human',
    action: 'campaign_created',
    entity_type: 'campaign',
    entity_id: data.id,
    summary: body.name,
  }).execute();

  return NextResponse.json({ ok: true, id: data.id });
}
