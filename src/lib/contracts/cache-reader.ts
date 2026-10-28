import type { CacheClient, CacheOptions } from './common.js';

/** Methods a reader exposes; nothing beyond {@link CacheClient}. */
export type CacheReader = CacheClient;

/** Options accepted by the reader; identical to {@link CacheOptions}. */
export type CacheReaderOptions = CacheOptions;

export type CreateCacheReader = (options?: CacheReaderOptions) => CacheReader;
