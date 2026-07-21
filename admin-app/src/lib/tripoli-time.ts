/**
 * Africa/Tripoli schedule handling. Libya is UTC+2 year-round (no DST since
 * 2013), but we derive the offset from the IANA zone instead of hardcoding it.
 */
export function tripoliOffsetMinutes(at: Date = new Date()): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Tripoli',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour === '24' ? '0' : parts.hour), Number(parts.minute), Number(parts.second),
  );
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** "2026-07-25T18:30" entered as Tripoli local time → UTC ISO string. */
export function tripoliLocalToUtc(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  const offset = tripoliOffsetMinutes(new Date(guess));
  return new Date(guess - offset * 60000).toISOString();
}

/** UTC ISO → display string in Tripoli time. */
export function utcToTripoliDisplay(iso: string): string {
  return new Intl.DateTimeFormat('ar-LY', {
    timeZone: 'Africa/Tripoli',
    dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(iso));
}
