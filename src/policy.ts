import type { CachePolicy } from './types.js';

export const DEFAULT_IN_MEMORY_TTL_MS = 300_000;

function readTtl(policy: unknown, label: string): number {
  if (typeof policy !== 'object' || policy === null) {
    throw new TypeError(`${label} must be an object with a numeric ttlMs`);
  }
  const ttlMs: unknown = (policy as { ttlMs?: unknown }).ttlMs;
  if (typeof ttlMs !== 'number') {
    throw new TypeError(`${label}.ttlMs must be a number`);
  }
  return ttlMs;
}

/** Copies and freezes a policy whose TTL is finite and not negative. */
export function localPolicy(policy: unknown, label: string): CachePolicy {
  const ttlMs = readTtl(policy, label);
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new RangeError(`${label}.ttlMs must be a finite number >= 0, got ${String(ttlMs)}`);
  }
  return Object.freeze({ ttlMs });
}

/** Copies and freezes a policy whose TTL is a positive safe integer. */
export function redisPolicy(policy: unknown, label: string): CachePolicy {
  const ttlMs = readTtl(policy, label);
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new RangeError(`${label}.ttlMs must be a positive safe integer, got ${String(ttlMs)}`);
  }
  return Object.freeze({ ttlMs });
}
