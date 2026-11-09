import type { CachePolicy } from './types.js';

/** Five minutes: the local TTL for clients and the in-memory tier's default. */
export const DEFAULT_IN_MEMORY_POLICY: CachePolicy = Object.freeze({ ttlMs: 300_000 });

/** Twelve hours: the Redis tier's default. */
export const DEFAULT_REDIS_POLICY: CachePolicy = Object.freeze({ ttlMs: 43_200_000 });
