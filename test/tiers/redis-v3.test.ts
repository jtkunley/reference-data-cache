import { describe, expect, it, vi } from 'vitest';
import {
  CacheTierTimeoutError,
  RedisCacheTier,
  createRedisCacheTierFromRedisV3,
  type RedisV3Client,
} from '../../src/index.js';

type Callback<T> = (error: Error | null, reply?: T) => void;

function fakeV3() {
  const data = new Map<string, string>();
  const client = {
    get: vi.fn((key: string, cb: Callback<string | null>) => {
      cb(null, data.get(key) ?? null);
    }),
    set: vi.fn((key: string, value: string, _mode: 'PX', _ttl: number, cb: Callback<unknown>) => {
      data.set(key, value);
      cb(null, 'OK');
    }),
    del: vi.fn((key: string, cb: Callback<unknown>) => {
      data.delete(key);
      cb(null, 1);
    }),
  };
  return { client, data };
}

describe('createRedisCacheTierFromRedisV3', () => {
  it('adapts callback get, set with PX, and del', async () => {
    const { client } = fakeV3();
    const tier = createRedisCacheTierFromRedisV3(client satisfies RedisV3Client);
    expect(tier).toBeInstanceOf(RedisCacheTier);
    tier.register('a', { ttlMs: 1_000 });
    await expect(tier.get('a')).resolves.toEqual({ hit: false });
    await tier.set('a', { x: 1 });
    expect(client.set).toHaveBeenCalledWith(
      'reference-data-cache:v1:a',
      '{"x":1}',
      'PX',
      1_000,
      expect.any(Function),
    );
    await expect(tier.get('a')).resolves.toEqual({ hit: true, value: { x: 1 } });
    await tier.delete('a');
    expect(client.del).toHaveBeenCalledWith('reference-data-cache:v1:a', expect.any(Function));
    await expect(tier.get('a')).resolves.toEqual({ hit: false });
  });

  it('passes options through', () => {
    const tier = createRedisCacheTierFromRedisV3(fakeV3().client, {
      defaultPolicy: { ttlMs: 60_000 },
    });
    expect(tier.defaultPolicy).toEqual({ ttlMs: 60_000 });
    expect(() =>
      createRedisCacheTierFromRedisV3(fakeV3().client, { operationTimeoutMs: 0 }),
    ).toThrow(RangeError);
  });

  it('preserves callback errors and synchronous throws', async () => {
    const { client } = fakeV3();
    const failure = new Error('NOAUTH');
    client.get.mockImplementationOnce((_key, cb) => {
      cb(failure);
    });
    client.del.mockImplementationOnce(() => {
      throw failure;
    });
    const tier = createRedisCacheTierFromRedisV3(client);
    tier.register('a');
    await expect(tier.get('a')).rejects.toBe(failure);
    await expect(tier.delete('a')).rejects.toBe(failure);
  });

  it('applies the operation timeout', async () => {
    const { client } = fakeV3();
    client.get.mockImplementationOnce(() => undefined);
    const tier = createRedisCacheTierFromRedisV3(client, { operationTimeoutMs: 5 });
    tier.register('a');
    await expect(tier.get('a')).rejects.toBeInstanceOf(CacheTierTimeoutError);
  });
});
