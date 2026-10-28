/** Package entry point: client factories, the built-in tiers, and the types callers need to set up a reader or owner. */

export { createCacheReader } from './cache-clients/cache-reader.js';
export { createCacheOwner } from './cache-clients/cache-owner.js';

export { InMemoryCacheTier } from './cache-tiers/in-memory-cache-tier.js';
export {
    DEFAULT_REDIS_OPERATION_TIMEOUT_MS,
    RedisCacheTier,
    type RedisCacheTierOptions,
} from './cache-tiers/redis/redis-cache-tier.js';
export {
    createRedisCacheTierFromRedisV3,
    type RedisV3Client,
} from './cache-tiers/redis/create-redis-cache-tier-from-redis-v3.js';

export {
    CacheDomainAlreadyRegisteredError,
    CacheDomainNotRegisteredError,
    CacheTierCorruptValueError,
    CacheTierSerializationError,
    CacheTierTimeoutError,
} from './errors.js';

export type {
    CacheDomain,
    CacheLoader,
    CachePolicy,
    CacheTier,
    CacheTierErrorEvent,
    CacheTierErrorKind,
    CacheTierOperation,
    SharedCacheClient,
} from './contracts/common.js';
export type {
    CacheReader,
    CacheReaderOptions,
} from './contracts/cache-reader.js';
export type { CacheOwner, CacheOwnerOptions } from './contracts/cache-owner.js';
