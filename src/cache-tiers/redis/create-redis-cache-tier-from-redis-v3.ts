import type { SharedCacheClient } from '../../contracts/common.js';
import {
    RedisCacheTier,
    type RedisCacheTierOptions,
} from './redis-cache-tier.js';

/**
 * The slice of the callback-style redis@3.x client that this adapter calls.
 *
 * Only `get`, `set` with a PX expiry, and `del` are described here, which
 * keeps the package free of any dependency on the real Redis typings.
 */
export interface RedisV3Client {
    get(
        key: string,
        callback: (err: Error | null, result: string | null) => void,
    ): void;

    set(
        key: string,
        value: string,
        mode: 'PX',
        ttlMs: number,
        callback: (err: Error | null) => void,
    ): void;

    del(key: string, callback: (err: Error | null) => void): void;
}

/**
 * Builds a RedisCacheTier on top of a redis@3.x client.
 *
 * Redis v3 exposes callbacks, while RedisCacheTier talks to a promise-based
 * SharedCacheClient; this factory wraps one in the other.
 *
 * Reach for it when an application still depends on the older `redis` v3.x
 * package, which has no built-in promise support.
 *
 * Usage:
 * ```ts
 * import redis from 'redis';
 * import { createRedisCacheTierFromRedisV3 } from '@jtkunley/reference-data-cache';
 *
 * const client = redis.createClient();
 * const tier = createRedisCacheTierFromRedisV3(client);
 * ```
 *
 * @param client - Callback-style redis@3.x client to wrap
 * @param options - Tier settings such as {@link RedisCacheTierOptions.defaultPolicy} and {@link RedisCacheTierOptions.operationTimeoutMs} (500 ms unless overridden)
 * @returns A RedisCacheTier backed by `client`
 */
export function createRedisCacheTierFromRedisV3(
    client: RedisV3Client,
    options?: RedisCacheTierOptions,
): RedisCacheTier {
    return new RedisCacheTier(toSharedCacheClient(client), options);
}

function toSharedCacheClient(client: RedisV3Client): SharedCacheClient {
    return {
        get(key: string) {
            return new Promise((resolve, reject) => {
                client.get(key, (err, result) => {
                    if (err) return reject(err);
                    resolve(result);
                });
            });
        },

        set(key: string, value: string, ttlMs: number) {
            return new Promise((resolve, reject) => {
                client.set(key, value, 'PX', ttlMs, (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        },

        delete(key: string) {
            return new Promise((resolve, reject) => {
                client.del(key, (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        },
    };
}
