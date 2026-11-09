/** Expiry policy for one cache tier. */
export interface CachePolicy {
  /** Time to live in milliseconds, measured from the latest successful write. */
  readonly ttlMs: number;
}

/** Produces the current value of a domain from its source of truth. */
export interface CacheLoader<T> {
  /**
   * Loads the whole domain value. Must not resolve to `null` or `undefined`.
   * No timeout is applied; a loader that never settles leaves its callers waiting.
   */
  load(): Promise<T>;
}

/** One named cached value and how to load it. */
export interface CacheDomain<T = unknown> {
  /** Exact, case-sensitive identifier. Must stay stable after registration. */
  readonly name: string;
  readonly loader: CacheLoader<T>;
  /** Overrides the client's local (in-memory) policy for this domain. */
  readonly inMemoryPolicy?: CachePolicy;
  /** Overrides the shared tier's default policy for this domain. Used by owners only. */
  readonly sharedPolicy?: CachePolicy;
}

/** Result of a tier read. Misses are explicit so falsy values can be cached. */
export type CacheTierResult<T> =
  { readonly hit: false } | { readonly hit: true; readonly value: T };

/** Name of a shared-tier operation. */
export type CacheTierOperation = 'get' | 'set' | 'delete';

/** Classification of a shared-tier failure. */
export type CacheTierErrorKind = 'timeout' | 'serialize' | 'corrupt-value' | 'error';

/** Reported to `onTierError` once per failed shared-tier operation. */
export interface CacheTierErrorEvent {
  readonly domain: string;
  readonly tier: 'shared';
  readonly operation: CacheTierOperation;
  readonly kind: CacheTierErrorKind;
  /** The original failure value, unchanged. */
  readonly error: unknown;
}

/**
 * A storage tier. Implement this to supply a custom shared tier.
 *
 * Synchronous throws from any method are treated like rejected promises.
 * Registration must not leave a partial registration behind when it fails.
 * No timeout is applied to custom tiers; an operation that never settles leaves callers waiting.
 */
export interface CacheTier {
  readonly defaultPolicy: CachePolicy;
  /** Changes the policy used by future registrations that do not supply one. */
  setDefaultPolicy(policy: CachePolicy): void;
  register(domainName: string, policy?: CachePolicy): void;
  /** Releases the domain name. Unknown names are ignored. */
  unregister(domainName: string): void;
  get<T = unknown>(domainName: string): Promise<CacheTierResult<T>>;
  set(domainName: string, value: unknown): Promise<void>;
  /** Removes the stored value. Succeeds when no value is stored. */
  delete(domainName: string): Promise<void>;
}

/** Options shared by readers and owners. */
export interface CacheReaderOptions {
  /** Default local policy for domains that do not supply `inMemoryPolicy`. Defaults to 5 minutes. */
  readonly inMemoryPolicy?: CachePolicy;
}

/** Options for {@link createCacheOwner}. */
export interface CacheOwnerOptions extends CacheReaderOptions {
  /** Tier shared with other processes, typically a {@link RedisCacheTier}. */
  readonly sharedTier: CacheTier;
  /**
   * Called once per failed shared-tier operation. Return values are ignored, and
   * thrown errors or rejected promises are contained.
   */
  readonly onTierError?: (event: CacheTierErrorEvent) => unknown;
}

/**
 * Caches domain values in local memory, loading them on demand.
 *
 * Concurrent misses for a domain share one load within this client only. There is no
 * cross-process or cross-client suppression of duplicate loads, and no guarantee about
 * the freshness of source data.
 */
export interface CacheReader {
  /** Registers a domain without loading it. Throws synchronously on duplicates or invalid policies. */
  register<T>(domain: CacheDomain<T>): void;
  /**
   * Returns the cached value, loading it on a miss. `T` is an unchecked assertion.
   * Rejects with {@link CacheDomainNotRegisteredError} for unknown domains and with the
   * loader's own error when loading fails.
   */
  get<T>(domainName: string): Promise<T>;
}

/**
 * A {@link CacheReader} that also reads and populates a shared tier, and can invalidate.
 *
 * Shared writes are best effort and are not awaited: a successful `get` does not mean
 * the value reached shared storage. There is no automatic cross-process invalidation
 * broadcast, no distributed loading lock, and no drain of background writes.
 */
export interface CacheOwner extends CacheReader {
  /**
   * Clears the local value and deletes the shared value. Resolves once the shared delete
   * succeeds and rejects with its failure otherwise; the local value is cleared either way.
   *
   * This is not an atomic freshness barrier: reads that overlap it may observe older
   * values, already-dispatched shared writes may land afterwards, and other clients keep
   * their local values until they expire or are invalidated there.
   */
  invalidate(domainName: string): Promise<void>;
}
