import { CacheDomainNotRegisteredError } from '../errors/registration-errors.js';
import { localPolicy } from '../policy/validate.js';
import type { CacheTier, CacheTierOperation, CacheTierResult } from '../tiers/types.js';
import { attempt } from '../util/attempt.js';
import { readLocal, storeLocal, supersede, type DomainState } from './domain-state.js';
import { ReaderClient } from './reader.js';
import { classifyTierError, reportTierError, type TierErrorHook } from './tier-error-reporting.js';
import type { CacheDomain, CacheOwner, CacheOwnerOptions } from './types.js';

const MISS: CacheTierResult<never> = Object.freeze({ hit: false });

/** Local client that reads through and populates a shared tier. */
class OwnerClient extends ReaderClient implements CacheOwner {
  readonly #tier: CacheTier;
  readonly #onTierError: TierErrorHook | undefined;

  constructor(options: CacheOwnerOptions) {
    super('CacheOwner', options);
    this.#tier = options.sharedTier;
    this.#onTierError = options.onTierError;
  }

  override register<T>(domain: CacheDomain<T>): void {
    const state = this.prepare(domain);
    const { sharedPolicy } = domain;
    const shared = localPolicy(
      sharedPolicy ?? this.#tier.defaultPolicy,
      `CacheOwner: domain "${state.name}" sharedPolicy`,
    );
    if (state.localTtlMs > shared.ttlMs) {
      throw new RangeError(
        `CacheOwner: domain "${state.name}" in-memory TTL (${String(state.localTtlMs)}ms) ` +
          `exceeds its shared TTL (${String(shared.ttlMs)}ms)`,
      );
    }
    this.#tier.register(state.name, shared);
    this.domains.set(state.name, state);
  }

  async invalidate(domainName: string): Promise<void> {
    const state = this.domains.get(domainName);
    if (state === undefined) {
      throw new CacheDomainNotRegisteredError(domainName, this.clientName);
    }
    supersede(state);
    try {
      await attempt(() => this.#tier.delete(domainName));
    } catch (error) {
      this.#report(domainName, 'delete', error);
      throw error;
    } finally {
      supersede(state);
    }
  }

  protected override async refresh(state: DomainState, generation: number): Promise<unknown> {
    const shared = await this.#readShared(state.name);
    if (shared.hit) {
      storeLocal(state, generation, shared.value);
      return shared.value;
    }
    const refilled = readLocal(state);
    if (refilled !== undefined) return refilled.value;
    const value = await this.load(state);
    if (storeLocal(state, generation, value)) {
      this.#background(state.name, 'set', () => this.#tier.set(state.name, value));
    }
    return value;
  }

  async #readShared(domainName: string): Promise<CacheTierResult<unknown>> {
    try {
      return await attempt(() => this.#tier.get(domainName));
    } catch (error) {
      this.#report(domainName, 'get', error);
      if (classifyTierError(error) === 'corrupt-value') {
        this.#background(domainName, 'delete', () => this.#tier.delete(domainName));
      }
      return MISS;
    }
  }

  #background(domainName: string, operation: CacheTierOperation, fn: () => Promise<void>): void {
    attempt(fn).catch((error: unknown) => {
      this.#report(domainName, operation, error);
    });
  }

  #report(domainName: string, operation: CacheTierOperation, error: unknown): void {
    reportTierError(this.#onTierError, domainName, operation, error);
  }
}

/** Creates a client that caches locally, shares values through `sharedTier`, and can invalidate. */
export function createCacheOwner(options: CacheOwnerOptions): CacheOwner {
  if (typeof options !== 'object' || (options as unknown) === null) {
    throw new TypeError('CacheOwner: options with a sharedTier are required');
  }
  if (typeof options.sharedTier !== 'object' || (options.sharedTier as unknown) === null) {
    throw new TypeError('CacheOwner: options.sharedTier is required');
  }
  if (options.onTierError !== undefined && typeof options.onTierError !== 'function') {
    throw new TypeError('CacheOwner: options.onTierError must be a function');
  }
  return new OwnerClient(options);
}
