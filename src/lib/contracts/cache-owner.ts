import type {
    CacheClient,
    CacheOptions,
    CacheTier,
    CacheTierErrorEvent,
} from './common.js';

/** Methods an owner exposes: everything in {@link CacheClient}, plus the ability to invalidate. */
export interface CacheOwner extends CacheClient {
    /**
     * The in-memory entry is removed no matter what. If deleting from the shared tier errors or times out, this rejects;
     * a timed-out delete can still land afterwards. In that case any process, this one included, may keep reading the old shared value until its TTL runs out.
     */
    invalidate(domainName: string): Promise<void>;
}

export interface CacheOwnerOptions extends CacheOptions {
    sharedTier: CacheTier;
    /** Hook invoked once per shared-tier failure, meant for logs and metrics. Anything it throws, sync or async, is discarded. */
    onTierError?: (event: CacheTierErrorEvent) => void;
}

export type CreateCacheOwner = (options: CacheOwnerOptions) => CacheOwner;
