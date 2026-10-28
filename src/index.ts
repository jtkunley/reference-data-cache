/** Package entry point: client factories, the built-in tiers, and the types callers need to set up a reader or owner. */

export { createCacheReader } from './lib/cache-clients/cache-reader.js';
export { createCacheOwner } from './lib/cache-clients/cache-owner.js';

export { InMemoryCacheTier } from './lib/cache-tiers/in-memory-cache-tier.js';
export {
    DEFAULT_REDIS_OPERATION_TIMEOUT_MS,
    RedisCacheTier,
    type RedisCacheTierOptions,
} from './lib/cache-tiers/redis/redis-cache-tier.js';
export { createRedisCacheTierFromRedisV3 } from './lib/cache-tiers/redis/create-redis-cache-tier-from-redis-v3.js';

export {
    CacheTierCorruptValueError,
    CacheTierSerializationError,
    CacheTierTimeoutError,
} from './lib/cache-tiers/cache-tier-errors.js';

export type {
    CacheDomain,
    CacheLoader,
    CachePolicy,
    CacheTier,
    CacheTierErrorEvent,
    CacheTierErrorKind,
    CacheTierOperation,
} from './lib/contracts/common.js';
export type {
    CacheReader,
    CacheReaderOptions,
} from './lib/contracts/cache-reader.js';
export type {
    CacheOwner,
    CacheOwnerOptions,
} from './lib/contracts/cache-owner.js';
