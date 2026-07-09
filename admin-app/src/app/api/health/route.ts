import { NextResponse } from 'next/server';
import { allIntegrationStatuses } from '@integrations/status';

export const runtime = 'nodejs';
// Must reflect runtime env (not be frozen at build time).
export const dynamic = 'force-dynamic';

/** Machine-readable integration health (used by the UI + uptime checks). */
export async function GET() {
  const statuses = allIntegrationStatuses();
  return NextResponse.json({
    ok: true,
    app: process.env.NEXT_PUBLIC_APP_NAME || 'EH-SYSTEM1',
    integrations: statuses.reduce(
      (acc, s) => ({ ...acc, [s.key]: { configured: s.configured, missing: s.missing } }),
      {} as Record<string, { configured: boolean; missing: string[] }>,
    ),
  });
}
