export const CACHE_KEY_PREFIX = 'reference-data-cache';

/** Increment whenever `RedisCacheTier` changes its stored format in a way old Redis entries can't be read with; this moves keys to a fresh namespace. Record the change in the CHANGELOG (see README, Development). */
export const CACHE_KEY_VERSION = 'v1';

export interface CachePolicy {
    ttlMs: number;
}

/**
 * Fetches the real data once every cache tier has missed.
 *
 * Implementations should either resolve to an actual value or throw; resolving to `null` or `undefined` is treated as an error.
 */
export interface CacheLoader<T> {
    load(): Promise<T>;
}

export interface CacheDomain<T> {
    name: string;
    loader: CacheLoader<T>;
    inMemoryPolicy?: CachePolicy;
    sharedPolicy?: CachePolicy;
}

export interface CacheClient {
    register<T>(domain: CacheDomain<T>): void;
    get<T>(domainName: string): Promise<T>;
}

export interface CacheOptions {
    inMemoryPolicy?: CachePolicy;
}

/** What a tier returns from `get`, so a miss can be told apart from a stored `null`. Internal; the package entry does not export it. */
export type CacheTierLookup<T> = { hit: false } | { hit: true; value: T };

export interface CacheTier {
    defaultPolicy: CachePolicy;
    setDefaultPolicy(policy: CachePolicy): void;
    register(domainName: string, policy: CachePolicy): void;
    get<T>(domainName: string): Promise<CacheTierLookup<T>>;
    set<T>(domainName: string, value: T): Promise<void>;
    delete(domainName: string): Promise<void>;
}

export interface SharedCacheClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlMs: number): Promise<void>;
    delete(key: string): Promise<void>;
}

/** Which shared (L2) tier call went wrong. */
export type CacheTierOperation = 'get' | 'set' | 'delete';

/**
 * `timeout`: the tier did not answer before its operation deadline.
 * `corrupt-value`: whatever was stored is unreadable.
 * `serialize`: the value could not be turned into a storable form.
 * `error`: anything not covered above.
 */
export type CacheTierErrorKind =
    'timeout' | 'corrupt-value' | 'serialize' | 'error';

export interface CacheTierErrorEvent {
    domain: string;
    tier: 'shared';
    operation: CacheTierOperation;
    kind: CacheTierErrorKind;
    error: unknown;
}
