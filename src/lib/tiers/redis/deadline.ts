import { CacheTierTimeoutError } from '../../errors/tier-errors.js';
import { attempt } from '../../util/attempt.js';
import type { CacheTierOperation } from '../types.js';

/** Deadline applied to each Redis read, write, and delete unless overridden. */
export const DEFAULT_REDIS_OPERATION_TIMEOUT_MS = 500;

const MAX_TIMER_MS = 2_147_483_647;

export function validateTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_REDIS_OPERATION_TIMEOUT_MS;
  if (
    typeof timeoutMs !== 'number' ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_TIMER_MS
  ) {
    throw new RangeError(
      `operationTimeoutMs must be a finite number in (0, ${String(MAX_TIMER_MS)}], got ${String(timeoutMs)}`,
    );
  }
  return timeoutMs;
}

/**
 * Runs `fn`, rejecting with {@link CacheTierTimeoutError} if it has not settled within
 * `timeoutMs`. A late result is discarded and a late rejection is contained.
 */
export function withDeadline<T>(
  domainName: string,
  operation: CacheTierOperation,
  timeoutMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new CacheTierTimeoutError(domainName, operation, timeoutMs));
    }, timeoutMs);
    attempt(fn).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
