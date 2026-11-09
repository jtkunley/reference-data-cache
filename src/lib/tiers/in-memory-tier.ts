import {
  CacheDomainAlreadyRegisteredError,
  CacheDomainNotRegisteredError,
} from '../errors/registration-errors.js';
import { DEFAULT_IN_MEMORY_POLICY } from '../policy/defaults.js';
import type { CachePolicy } from '../policy/types.js';
import { localPolicy } from '../policy/validate.js';
import { assertDomainName } from '../util/domain-name.js';
import type { CacheTier, CacheTierResult } from './types.js';

/** Options for {@link InMemoryCacheTier}. */
export interface InMemoryCacheTierOptions {
  /** Defaults to a five-minute TTL. */
  readonly defaultPolicy?: CachePolicy;
}

interface Slot {
  readonly policy: CachePolicy;
  entry?: { readonly value: unknown; readonly expiresAt: number };
}

/**
 * A process-local tier. Stores any value, including `null` and `undefined`, by reference
 * until it expires. Expired entries are dropped when read; there is no capacity limit.
 */
export class InMemoryCacheTier implements CacheTier {
  static readonly NAME = 'in-memory';

  readonly #slots = new Map<string, Slot>();
  #defaultPolicy: CachePolicy;

  constructor(options: InMemoryCacheTierOptions = {}) {
    this.#defaultPolicy =
      options.defaultPolicy === undefined
        ? DEFAULT_IN_MEMORY_POLICY
        : localPolicy(options.defaultPolicy, 'defaultPolicy');
  }

  get defaultPolicy(): CachePolicy {
    return this.#defaultPolicy;
  }

  setDefaultPolicy(policy: CachePolicy): void {
    this.#defaultPolicy = localPolicy(policy, 'defaultPolicy');
  }

  register(domainName: string, policy: CachePolicy = this.#defaultPolicy): void {
    assertDomainName(domainName, 'Cache');
    const accepted = localPolicy(policy, 'policy');
    if (this.#slots.has(domainName)) {
      throw new CacheDomainAlreadyRegisteredError(domainName);
    }
    this.#slots.set(domainName, { policy: accepted });
  }

  unregister(domainName: string): void {
    this.#slots.delete(domainName);
  }

  get<T = unknown>(domainName: string): Promise<CacheTierResult<T>> {
    try {
      const slot = this.#slot(domainName);
      const entry = slot.entry;
      if (entry === undefined) return Promise.resolve({ hit: false });
      if (Date.now() >= entry.expiresAt) {
        delete slot.entry;
        return Promise.resolve({ hit: false });
      }
      return Promise.resolve({ hit: true, value: entry.value as T });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  set(domainName: string, value: unknown): Promise<void> {
    try {
      const slot = this.#slot(domainName);
      slot.entry = { value, expiresAt: Date.now() + slot.policy.ttlMs };
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  delete(domainName: string): Promise<void> {
    try {
      delete this.#slot(domainName).entry;
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #slot(domainName: string): Slot {
    const slot = this.#slots.get(domainName);
    if (slot === undefined) throw new CacheDomainNotRegisteredError(domainName);
    return slot;
  }
}
