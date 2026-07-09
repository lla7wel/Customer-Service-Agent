import { PlugZap, ExternalLink } from 'lucide-react';
import type { IntegrationStatus } from '@integrations/status';

/**
 * Reusable "this integration is not wired up yet" card. Shows the exact missing
 * env vars + points to setup docs. Used everywhere a page needs Supabase /
 * Gemini / Meta so we never fake data.
 */
export default function NotConnected({
  status,
  title,
  help,
}: {
  status: IntegrationStatus;
  title?: string;
  help?: string;
}) {
  return (
    <div className="card overflow-hidden p-0">
      <div className="flex items-start gap-4 border-b border-line bg-warning/5 p-5">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
          <PlugZap size={20} />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-fg">{title ?? `${status.label} — not connected`}</h3>
          <p className="mt-1 text-sm text-muted">{help ?? status.hint}</p>
        </div>
        <span className="chip bg-warning/12 text-warning ring-warning/25">Setup required</span>
      </div>
      {status.missing.length > 0 && (
        <div className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Missing environment variables</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {status.missing.map((m) => (
              <li key={m} className="rounded-md border border-line bg-surface2 px-2 py-1 font-mono text-xs text-warning">
                {m}
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
            <ExternalLink size={13} />
            Configure in <span className="font-mono text-fg">admin-app/.env.local</span> — see{' '}
            <span className="font-mono text-fg">docs/SETUP.md</span>
          </p>
        </div>
      )}
    </div>
  );
}
