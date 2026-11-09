import {
  CacheDomainAlreadyRegisteredError,
  CacheDomainNotRegisteredError,
} from '../../errors/registration-errors.js';
import { DEFAULT_REDIS_POLICY } from '../../policy/defaults.js';
import type { CachePolicy } from '../../policy/types.js';
import { redisPolicy } from '../../policy/validate.js';
import { assertDomainName } from '../../util/domain-name.js';
import type { CacheTier, CacheTierResult } from '../types.js';
import { validateTimeout, withDeadline } from './deadline.js';
import { deserialize, serialize } from './json.js';
import { redisKey } from './keys.js';

/**
 * The minimal promise-based client {@link RedisCacheTier} needs. Wrap your Redis client
 * of choice to fit; connection lifecycle stays with the caller.
 */
export interface RedisCacheClient {
  /** Resolves to the stored string, or `null` when the key does not exist. */
  get(key: string): Promise<string | null>;
  /** Stores `value` with an expiry of `ttlMs` milliseconds (for example `SET key value PX ttlMs`). */
  set(key: string, value: string, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Options for {@link RedisCacheTier} and {@link createRedisCacheTierFromRedisV3}. */
export interface RedisCacheTierOptions {
  /** Defaults to a 12-hour TTL. Redis TTLs must be positive safe integers. */
  readonly defaultPolicy?: CachePolicy;
  /** Per-operation deadline in milliseconds. Defaults to {@link DEFAULT_REDIS_OPERATION_TIMEOUT_MS}. */
  readonly operationTimeoutMs?: number;
}

/**
 * A shared tier backed by Redis. Values are stored as JSON under
 * `reference-data-cache:v1:<domainName>`, so they follow JSON conversion rules.
 *
 * Each client call has its own deadline. A timeout stops waiting but does not cancel the
 * request, so timed-out writes and deletes may still take effect later.
 */
export class RedisCacheTier implements CacheTier {
  static readonly NAME = 'redis';

  readonly #client: RedisCacheClient;
  readonly #timeoutMs: number;
  readonly #policies = new Map<string, CachePolicy>();
  #defaultPolicy: CachePolicy;

  constructor(client: RedisCacheClient, options: RedisCacheTierOptions = {}) {
    this.#client = client;
    this.#defaultPolicy =
      options.defaultPolicy === undefined
        ? DEFAULT_REDIS_POLICY
        : redisPolicy(options.defaultPolicy, 'defaultPolicy');
    this.#timeoutMs = validateTimeout(options.operationTimeoutMs);
  }

  get defaultPolicy(): CachePolicy {
    return this.#defaultPolicy;
  }

  setDefaultPolicy(policy: CachePolicy): void {
    this.#defaultPolicy = redisPolicy(policy, 'defaultPolicy');
  }

  register(domainName: string, policy: CachePolicy = this.#defaultPolicy): void {
    assertDomainName(domainName, 'Cache');
    const accepted = redisPolicy(policy, 'policy');
    if (this.#policies.has(domainName)) {
      throw new CacheDomainAlreadyRegisteredError(domainName);
    }
    this.#policies.set(domainName, accepted);
  }

  /** Forgets the registration. The stored Redis key is left in place. */
  unregister(domainName: string): void {
    this.#policies.delete(domainName);
  }

  async get<T = unknown>(domainName: string): Promise<CacheTierResult<T>> {
    this.#policy(domainName);
    const raw: unknown = await withDeadline(domainName, 'get', this.#timeoutMs, () =>
      this.#client.get(redisKey(domainName)),
    );
    if (raw === null) return { hit: false };
    return { hit: true, value: deserialize(domainName, raw) as T };
  }

  set(domainName: string, value: unknown): Promise<void> {
    let ttlMs: number;
    let payload: string;
    try {
      ttlMs = this.#policy(domainName).ttlMs;
      payload = serialize(domainName, value);
    } catch (error) {
      return Promise.reject(error);
    }
    return withDeadline(domainName, 'set', this.#timeoutMs, () =>
      this.#client.set(redisKey(domainName), payload, ttlMs),
    );
  }

  async delete(domainName: string): Promise<void> {
    this.#policy(domainName);
    await withDeadline(domainName, 'delete', this.#timeoutMs, () =>
      this.#client.delete(redisKey(domainName)),
    );
  }

  #policy(domainName: string): CachePolicy {
    const policy = this.#policies.get(domainName);
    if (policy === undefined) throw new CacheDomainNotRegisteredError(domainName);
    return policy;
  }
}
