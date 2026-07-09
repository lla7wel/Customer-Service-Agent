/**
 * Runtime feature flags.
 *
 * A value counts as "on" only when it is exactly "true" (case-insensitive).
 */
import { env } from './env';

function on(key: string): boolean {
  return (env(key) ?? '').trim().toLowerCase() === 'true';
}

/**
 * Whether to BATCH a burst of customer messages (text + images + links) into one
 * AI turn instead of replying to each separately. ON by default — set
 * ENABLE_MESSAGE_BATCHING=false (or 0/off) to disable. Uses a column-free
 * debounce (message recency), so no migration is required.
 */
export function messageBatchingEnabled(): boolean {
  const v = (env('ENABLE_MESSAGE_BATCHING') ?? '').trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}

/** Debounce window (ms) for batching a burst into one AI turn. 5s by decision. */
export function batchWindowMs(): number {
  const v = parseInt((env('MESSAGE_BATCH_WINDOW_MS') ?? '').trim(), 10);
  return Number.isFinite(v) && v >= 1000 && v <= 30000 ? v : 5000;
}
