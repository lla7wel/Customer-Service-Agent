import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/* ------------------------------------------------------------------ headers */
export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line/70 bg-surface/70 px-4 py-3 shadow-card backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent shadow-glow">
            <Icon size={20} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
          {subtitle && <p className="mt-0.5 max-w-3xl text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({
  title,
  icon: Icon,
  action,
  count,
}: {
  title: string;
  icon?: LucideIcon;
  action?: ReactNode;
  count?: number | string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={15} className="text-accent" />}
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {count != null && (
          <span className="rounded-full bg-surface2 px-2 py-0.5 text-xs text-muted">{count}</span>
        )}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------- cards */
export function Card({
  children,
  className = '',
  pad = true,
}: {
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return <div className={`card hairline-top ${pad ? 'p-5' : ''} ${className}`}>{children}</div>;
}

/* ---------------------------------------------------------------- stat card */
type Tone = 'default' | 'accent' | 'good' | 'warn' | 'bad' | 'muted';
const STAT_ICON: Record<Tone, string> = {
  default: 'text-fg',
  accent: 'text-accent',
  good: 'text-success',
  warn: 'text-warning',
  bad: 'text-danger',
  muted: 'text-faint',
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  tone?: Tone;
  href?: string;
}) {
  const inner = (
    <div className="card group relative overflow-hidden p-4 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent opacity-0 transition group-hover:opacity-100" />
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        {Icon && (
          <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface2 ${STAT_ICON[tone]}`}>
            <Icon size={16} />
          </span>
        )}
      </div>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-warning' : 'text-fg'}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}
    </div>
  );
  if (href) {
    return (
      <a href={href} className="block">
        {inner}
      </a>
    );
  }
  return inner;
}

/* ------------------------------------------------------------------ badges */
const BADGE: Record<string, string> = {
  good: 'bg-success/12 text-success ring-success/25',
  warn: 'bg-warning/12 text-warning ring-warning/25',
  bad: 'bg-danger/12 text-danger ring-danger/25',
  info: 'bg-info/12 text-info ring-info/25',
  accent: 'bg-accent/12 text-accent ring-accent/25',
  neutral: 'bg-surface2 text-muted ring-line',
};

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE;
  dot?: boolean;
}) {
  return (
    <span className={`chip ${BADGE[tone]}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotColor(tone)}`} />}
      {children}
    </span>
  );
}
// alias for older imports
export const Pill = Badge;

function dotColor(tone: keyof typeof BADGE) {
  return {
    good: 'bg-success',
    warn: 'bg-warning',
    bad: 'bg-danger',
    info: 'bg-info',
    accent: 'bg-accent',
    neutral: 'bg-faint',
  }[tone];
}

/* ------------------------------------------------------------- empty/notice */
export function EmptyState({
  title,
  hint,
  icon: Icon,
  action,
}: {
  title: string;
  hint?: string;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface2/40 px-6 py-14 text-center">
      {Icon && (
        <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-surface2 text-faint">
          <Icon size={22} />
        </span>
      )}
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-xs text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({
  children,
  tone = 'info',
  icon: Icon,
}: {
  children: ReactNode;
  tone?: 'info' | 'error' | 'warn';
  icon?: LucideIcon;
}) {
  const cls =
    tone === 'error'
      ? 'border-danger/30 bg-danger/10 text-danger'
      : tone === 'warn'
        ? 'border-warning/30 bg-warning/10 text-warning'
        : 'border-info/30 bg-info/10 text-info';
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${cls}`}>
      {Icon && <Icon size={16} className="mt-0.5 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

/* --------------------------------------------------------------- skeletons */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse2 rounded-md bg-surface2 ${className}`} />;
}

/* --------------------------------------------------------------- mini-bar  */
export function Meter({ value, max = 100, tone = 'accent' }: { value: number; max?: number; tone?: 'accent' | 'good' | 'warn' | 'bad' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bar = { accent: 'bg-accent', good: 'bg-success', warn: 'bg-warning', bad: 'bg-danger' }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface2">
      <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
