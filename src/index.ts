export { createCacheOwner } from './lib/clients/owner.js';
export { createCacheReader } from './lib/clients/reader.js';
export type {
  CacheDomain,
  CacheLoader,
  CacheOwner,
  CacheOwnerOptions,
  CacheReader,
  CacheReaderOptions,
  CacheTierErrorEvent,
  CacheTierErrorKind,
} from './lib/clients/types.js';

export type { CachePolicy } from './lib/policy/types.js';

export type { CacheTier, CacheTierOperation, CacheTierResult } from './lib/tiers/types.js';
export { InMemoryCacheTier, type InMemoryCacheTierOptions } from './lib/tiers/in-memory-tier.js';
export { DEFAULT_REDIS_OPERATION_TIMEOUT_MS } from './lib/tiers/redis/deadline.js';
export {
  RedisCacheTier,
  type RedisCacheClient,
  type RedisCacheTierOptions,
} from './lib/tiers/redis/redis-tier.js';
export {
  createRedisCacheTierFromRedisV3,
  type RedisV3Callback,
  type RedisV3Client,
} from './lib/tiers/redis/redis-v3.js';

export {
  CacheDomainAlreadyRegisteredError,
  CacheDomainNotRegisteredError,
} from './lib/errors/registration-errors.js';
export {
  CacheTierCorruptValueError,
  CacheTierSerializationError,
  CacheTierTimeoutError,
} from './lib/errors/tier-errors.js';
