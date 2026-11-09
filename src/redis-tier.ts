import {
  CacheDomainAlreadyRegisteredError,
  CacheDomainNotRegisteredError,
  CacheTierCorruptValueError,
  CacheTierSerializationError,
  CacheTierTimeoutError,
} from './errors.js';
import { assertDomainName, attempt } from './internal.js';
import { redisPolicy } from './policy.js';
import type { CachePolicy, CacheTier, CacheTierOperation, CacheTierResult } from './types.js';

/** Deadline applied to each Redis read, write, and delete unless overridden. */
export const DEFAULT_REDIS_OPERATION_TIMEOUT_MS = 500;

const DEFAULT_REDIS_TTL_MS = 43_200_000;
const MAX_TIMER_MS = 2_147_483_647;
const KEY_PREFIX = 'reference-data-cache:v1:';

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
        ? Object.freeze({ ttlMs: DEFAULT_REDIS_TTL_MS })
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
    const raw: unknown = await this.#call(domainName, 'get', () =>
      this.#client.get(KEY_PREFIX + domainName),
    );
    if (raw === null) return { hit: false };
    if (typeof raw !== 'string') {
      throw new CacheTierCorruptValueError(domainName, {
        cause: new TypeError(`expected a string from Redis, got ${typeof raw}`),
      });
    }
    try {
      return { hit: true, value: JSON.parse(raw) as T };
    } catch (error) {
      throw new CacheTierCorruptValueError(domainName, { cause: error });
    }
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
    return this.#call(domainName, 'set', () =>
      this.#client.set(KEY_PREFIX + domainName, payload, ttlMs),
    );
  }

  async delete(domainName: string): Promise<void> {
    this.#policy(domainName);
    await this.#call(domainName, 'delete', () => this.#client.delete(KEY_PREFIX + domainName));
  }

  #policy(domainName: string): CachePolicy {
    const policy = this.#policies.get(domainName);
    if (policy === undefined) throw new CacheDomainNotRegisteredError(domainName);
    return policy;
  }

  #call<T>(domainName: string, operation: CacheTierOperation, fn: () => Promise<T>): Promise<T> {
    const timeoutMs = this.#timeoutMs;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new CacheTierTimeoutError(domainName, operation, timeoutMs));
      }, timeoutMs);
      attempt(fn).then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}

function serialize(domainName: string, value: unknown): string {
  let payload: unknown;
  try {
    payload = JSON.stringify(value);
  } catch (error) {
    throw new CacheTierSerializationError(
      domainName,
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  if (typeof payload !== 'string') throw new CacheTierSerializationError(domainName);
  return payload;
}

function validateTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_REDIS_OPERATION_TIMEOUT_MS;
  if (
    typeof timeoutMs !== 'number' ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_TIMER_MS
  ) {
    throw new RangeError(
      `operationTimeoutMs must be a finite number in (0, ${String(MAX_TIMER_MS)}], got ${String(timeoutMs)}`,
    );
  }
  return timeoutMs;
}
