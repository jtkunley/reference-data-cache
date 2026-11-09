import type { CachePolicy } from '../policy/types.js';

/** Result of a tier read. Misses are explicit so falsy values can be cached. */
export type CacheTierResult<T> =
  { readonly hit: false } | { readonly hit: true; readonly value: T };

/** Name of a shared-tier operation. */
export type CacheTierOperation = 'get' | 'set' | 'delete';

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
