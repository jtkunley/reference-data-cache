import { RedisCacheTier, type RedisCacheTierOptions } from './redis-tier.js';

/** Node-style callback used by {@link RedisV3Client}. */
export type RedisV3Callback<T> = (error: Error | null | undefined, reply?: T) => void;

/** The callback API of the `redis` package v3 (and compatible clients) used by the adapter. */
export interface RedisV3Client {
  get(key: string, callback: RedisV3Callback<string | null>): unknown;
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttlMs: number,
    callback: RedisV3Callback<unknown>,
  ): unknown;
  del(key: string, callback: RedisV3Callback<unknown>): unknown;
}

/**
 * Builds a {@link RedisCacheTier} over a callback-style Redis v3 client. Callback errors
 * become operation failures unchanged; connection lifecycle stays with the caller.
 */
export function createRedisCacheTierFromRedisV3(
  client: RedisV3Client,
  options?: RedisCacheTierOptions,
): RedisCacheTier {
  return new RedisCacheTier(
    {
      get: (key) =>
        new Promise((resolve, reject) => {
          client.get(key, (error, reply) => {
            if (error) reject(error);
            else resolve(reply ?? null);
          });
        }),
      set: (key, value, ttlMs) =>
        new Promise((resolve, reject) => {
          client.set(key, value, 'PX', ttlMs, (error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
      delete: (key) =>
        new Promise((resolve, reject) => {
          client.del(key, (error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
    },
    options,
  );
}
