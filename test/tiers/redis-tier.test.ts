import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CacheDomainAlreadyRegisteredError,
  CacheDomainNotRegisteredError,
  CacheTierCorruptValueError,
  CacheTierSerializationError,
  CacheTierTimeoutError,
  DEFAULT_REDIS_OPERATION_TIMEOUT_MS,
  RedisCacheTier,
} from '../../src/index.js';
import { FakeRedis, flush } from '../support/helpers.js';

const KEY = 'reference-data-cache:v1:Countries';

function setup(options?: ConstructorParameters<typeof RedisCacheTier>[1]) {
  const redis = new FakeRedis();
  const tier = new RedisCacheTier(redis, options);
  tier.register('Countries');
  return { redis, tier };
}

describe('RedisCacheTier', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is named redis with a 12-hour default policy and a 500ms timeout', () => {
    expect(RedisCacheTier.NAME).toBe('redis');
    expect(new RedisCacheTier(new FakeRedis()).defaultPolicy).toEqual({ ttlMs: 43_200_000 });
    expect(DEFAULT_REDIS_OPERATION_TIMEOUT_MS).toBe(500);
  });

  it('round-trips JSON under the versioned key with the registered TTL', async () => {
    const { redis, tier } = setup();
    await tier.set('Countries', [{ code: 'NZ' }]);
    expect(redis.set).toHaveBeenCalledWith(KEY, '[{"code":"NZ"}]', 43_200_000);
    await expect(tier.get('Countries')).resolves.toEqual({ hit: true, value: [{ code: 'NZ' }] });
    await tier.delete('Countries');
    expect(redis.delete).toHaveBeenCalledWith(KEY);
  });

  it('treats a null reply as a miss and JSON null as a hit', async () => {
    const { redis, tier } = setup();
    await expect(tier.get('Countries')).resolves.toEqual({ hit: false });
    redis.data.set(KEY, { value: 'null', ttlMs: 1 });
    await expect(tier.get('Countries')).resolves.toEqual({ hit: true, value: null });
  });

  it('rejects malformed JSON as corrupt, keeping the parse error as the cause', async () => {
    const { redis, tier } = setup();
    redis.data.set(KEY, { value: '{', ttlMs: 1 });
    const error: unknown = await tier.get('Countries').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CacheTierCorruptValueError);
    expect(error).toMatchObject({ domainName: 'Countries', name: 'CacheTierCorruptValueError' });
    expect((error as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it.each([
    [
      'a circular structure',
      (() => {
        const value: Record<string, unknown> = {};
        value['self'] = value;
        return value;
      })(),
      true,
    ],
    ['a BigInt', 10n, true],
    ['a function', () => 1, false],
    ['undefined', undefined, false],
  ])('rejects %s as unserializable without writing', async (_label, value, hasCause) => {
    const { redis, tier } = setup();
    const error: unknown = await tier.set('Countries', value).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CacheTierSerializationError);
    expect((error as Error).cause instanceof Error).toBe(hasCause);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('applies toJSON and normal JSON conversion', async () => {
    const { tier } = setup();
    await tier.set('Countries', { at: new Date(0), skip: undefined });
    await expect(tier.get('Countries')).resolves.toEqual({
      hit: true,
      value: { at: '1970-01-01T00:00:00.000Z' },
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'rejects Redis TTL %s',
    (ttlMs) => {
      const tier = new RedisCacheTier(new FakeRedis());
      expect(() => {
        tier.setDefaultPolicy({ ttlMs });
      }).toThrow(RangeError);
      expect(() => {
        tier.register('a', { ttlMs });
      }).toThrow(RangeError);
      expect(() => new RedisCacheTier(new FakeRedis(), { defaultPolicy: { ttlMs } })).toThrow(
        RangeError,
      );
      expect(() => {
        tier.register('a');
      }).not.toThrow();
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'rejects operation timeout %s',
    (operationTimeoutMs) => {
      expect(() => new RedisCacheTier(new FakeRedis(), { operationTimeoutMs })).toThrow(RangeError);
    },
  );

  it('rejects duplicate registration and unregistered operations', async () => {
    const { tier } = setup();
    expect(() => {
      tier.register('Countries');
    }).toThrow(CacheDomainAlreadyRegisteredError);
    for (const op of [() => tier.get('x'), () => tier.set('x', 1), () => tier.delete('x')]) {
      await expect(op()).rejects.toBeInstanceOf(CacheDomainNotRegisteredError);
    }
  });

  it('unregisters locally without deleting the stored key', async () => {
    const { redis, tier } = setup();
    await tier.set('Countries', 1);
    tier.unregister('Countries');
    expect(redis.delete).not.toHaveBeenCalled();
    expect(redis.data.has(KEY)).toBe(true);
    tier.register('Countries');
  });

  it('times out each operation independently and ignores late outcomes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { redis, tier } = setup({ operationTimeoutMs: 50 });
    let rejectLate!: (error: Error) => void;
    redis.delete.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectLate = reject;
      }),
    );
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const pending = tier.delete('Countries').catch((e: unknown) => e);
      vi.advanceTimersByTime(50);
      const error = await pending;
      expect(error).toBeInstanceOf(CacheTierTimeoutError);
      expect(error).toMatchObject({ domainName: 'Countries', operation: 'delete', timeoutMs: 50 });
      rejectLate(new Error('late'));
      await flush();
      expect(unhandled).not.toHaveBeenCalled();
      await expect(tier.get('Countries')).resolves.toEqual({ hit: false });
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('clears deadline timers when operations settle', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { tier } = setup();
    await tier.set('Countries', 1);
    await tier.get('Countries');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves client errors', async () => {
    const { redis, tier } = setup();
    const failure = new Error('ECONNRESET');
    redis.get.mockRejectedValueOnce(failure);
    redis.set.mockImplementationOnce(() => {
      throw failure;
    });
    await expect(tier.get('Countries')).rejects.toBe(failure);
    await expect(tier.set('Countries', 1)).rejects.toBe(failure);
  });
});
