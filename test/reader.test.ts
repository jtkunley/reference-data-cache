import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CacheDomainAlreadyRegisteredError,
  CacheDomainNotRegisteredError,
  createCacheReader,
} from '../src/index.js';
import { deferred, flush, loaderOf } from './helpers.js';

describe('createCacheReader', () => {
  describe('registration', () => {
    it('does not invoke the loader on registration', () => {
      const loader = loaderOf(() => 1);
      createCacheReader().register({ name: 'a', loader });
      expect(loader.load).not.toHaveBeenCalled();
    });

    it('rejects duplicates synchronously, naming the client', () => {
      const reader = createCacheReader();
      reader.register({ name: 'a', loader: loaderOf(() => 1) });
      expect(() => {
        reader.register({ name: 'a', loader: loaderOf(() => 2) });
      }).toThrow(CacheDomainAlreadyRegisteredError);
      expect(() => {
        reader.register({ name: 'a', loader: loaderOf(() => 2) });
      }).toThrow(/CacheReader/);
    });

    it('treats names as case-sensitive', () => {
      const reader = createCacheReader();
      reader.register({ name: 'a', loader: loaderOf(() => 1) });
      expect(() => {
        reader.register({ name: 'A', loader: loaderOf(() => 2) });
      }).not.toThrow();
    });

    it('keeps registrations independent between clients', async () => {
      const first = createCacheReader();
      const second = createCacheReader();
      first.register({ name: 'a', loader: loaderOf(() => 1) });
      second.register({ name: 'a', loader: loaderOf(() => 2) });
      await expect(first.get('a')).resolves.toBe(1);
      await expect(second.get('a')).resolves.toBe(2);
    });

    it('leaves nothing registered when registration fails, so it can be retried', () => {
      const reader = createCacheReader();
      expect(() => {
        reader.register({ name: 'a', loader: loaderOf(() => 1), inMemoryPolicy: { ttlMs: -1 } });
      }).toThrow(RangeError);
      expect(() => {
        reader.register({ name: 'a', loader: loaderOf(() => 1) });
      }).not.toThrow();
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('rejects local TTL %s', (ttlMs) => {
      expect(() => createCacheReader({ inMemoryPolicy: { ttlMs } })).toThrow(RangeError);
    });

    it('copies policies so later mutation has no effect', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const policy = { ttlMs: 1_000 };
        const loader = loaderOf(() => 1);
        const reader = createCacheReader();
        reader.register({ name: 'a', loader, inMemoryPolicy: policy });
        policy.ttlMs = 0;
        await reader.get('a');
        await reader.get('a');
        expect(loader.load).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('reads', () => {
    it('rejects reads of unknown domains', async () => {
      const reader = createCacheReader();
      await expect(reader.get('missing')).rejects.toBeInstanceOf(CacheDomainNotRegisteredError);
      await expect(reader.get('missing')).rejects.toMatchObject({ domainName: 'missing' });
    });

    it('loads on a miss and serves later reads locally', async () => {
      const loader = loaderOf(() => ({ id: 1 }));
      const reader = createCacheReader();
      reader.register({ name: 'a', loader });
      const first = await reader.get('a');
      const second = await reader.get('a');
      expect(second).toBe(first);
      expect(loader.load).toHaveBeenCalledTimes(1);
    });

    it.each([false, 0, '', [], {}])('accepts falsy and empty value %j', async (value) => {
      const loader = loaderOf(() => value);
      const reader = createCacheReader();
      reader.register({ name: 'a', loader });
      await expect(reader.get('a')).resolves.toEqual(value);
      await reader.get('a');
      expect(loader.load).toHaveBeenCalledTimes(1);
    });

    it.each([null, undefined])(
      'rejects a loader result of %s without caching it',
      async (value) => {
        const loader = loaderOf(() => value);
        const reader = createCacheReader();
        reader.register({ name: 'ref', loader });
        await expect(reader.get('ref')).rejects.toThrow(
          new RegExp(`CacheReader.*"ref".*${String(value)}`),
        );
        await expect(reader.get('ref')).rejects.toThrow();
        expect(loader.load).toHaveBeenCalledTimes(2);
      },
    );

    it('propagates loader rejections and synchronous throws, then retries on the next read', async () => {
      const failure = new Error('source down');
      let calls = 0;
      const reader = createCacheReader();
      reader.register({
        name: 'a',
        loader: {
          load: () => {
            calls += 1;
            if (calls === 1) throw failure;
            if (calls === 2) return Promise.reject(failure);
            return Promise.resolve('ok');
          },
        },
      });
      await expect(reader.get('a')).rejects.toBe(failure);
      await expect(reader.get('a')).rejects.toBe(failure);
      await expect(reader.get('a')).resolves.toBe('ok');
      expect(calls).toBe(3);
    });

    it('shares one load between concurrent misses, including its failure', async () => {
      const pending = deferred<string>();
      const loader = { load: vi.fn(() => pending.promise) };
      const reader = createCacheReader();
      reader.register({ name: 'a', loader });
      const reads = [reader.get('a'), reader.get('a'), reader.get('a')];
      const failure = new Error('boom');
      pending.reject(failure);
      for (const read of reads) await expect(read).rejects.toBe(failure);
      expect(loader.load).toHaveBeenCalledTimes(1);
    });

    it('loads different domains independently', async () => {
      const slow = deferred<string>();
      const reader = createCacheReader();
      reader.register({ name: 'slow', loader: { load: () => slow.promise } });
      reader.register({ name: 'fast', loader: loaderOf(() => 'fast') });
      const slowRead = reader.get('slow');
      await expect(reader.get('fast')).resolves.toBe('fast');
      slow.resolve('slow');
      await expect(slowRead).resolves.toBe('slow');
    });

    it('preserves local values by reference', async () => {
      const reader = createCacheReader();
      reader.register({ name: 'a', loader: loaderOf(() => ({ count: 0 })) });
      const value = await reader.get<{ count: number }>('a');
      value.count = 5;
      await expect(reader.get('a')).resolves.toEqual({ count: 5 });
      expect(Object.isFrozen(value)).toBe(false);
    });
  });

  describe('expiry', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('defaults to a five-minute TTL', async () => {
      const loader = loaderOf(() => 1);
      const reader = createCacheReader();
      reader.register({ name: 'a', loader });
      await reader.get('a');
      vi.advanceTimersByTime(299_999);
      await reader.get('a');
      expect(loader.load).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      await reader.get('a');
      expect(loader.load).toHaveBeenCalledTimes(2);
    });

    it('lets a domain policy override the client default', async () => {
      const loader = loaderOf(() => 1);
      const reader = createCacheReader({ inMemoryPolicy: { ttlMs: 10 } });
      reader.register({ name: 'a', loader, inMemoryPolicy: { ttlMs: 100 } });
      await reader.get('a');
      vi.advanceTimersByTime(50);
      await reader.get('a');
      expect(loader.load).toHaveBeenCalledTimes(1);
    });

    it('treats a zero TTL as immediately expired', async () => {
      const loader = loaderOf(() => 1);
      const reader = createCacheReader({ inMemoryPolicy: { ttlMs: 0 } });
      reader.register({ name: 'a', loader });
      await reader.get('a');
      await reader.get('a');
      expect(loader.load).toHaveBeenCalledTimes(2);
    });

    it('does not extend lifetime on reads', async () => {
      const loader = loaderOf(() => 1);
      const reader = createCacheReader({ inMemoryPolicy: { ttlMs: 100 } });
      reader.register({ name: 'a', loader });
      await reader.get('a');
      vi.advanceTimersByTime(60);
      await reader.get('a');
      vi.advanceTimersByTime(40);
      await reader.get('a');
      expect(loader.load).toHaveBeenCalledTimes(2);
    });

    it('accepts fractional TTLs', async () => {
      const loader = loaderOf(() => 1);
      const reader = createCacheReader({ inMemoryPolicy: { ttlMs: 0.5 } });
      reader.register({ name: 'a', loader });
      await reader.get('a');
      await reader.get('a');
      expect(loader.load).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      await reader.get('a');
      expect(loader.load).toHaveBeenCalledTimes(2);
    });
  });

  it('does not start a second load when a refresh already filled the cache', async () => {
    const pending = deferred<number>();
    const loader = { load: vi.fn(() => pending.promise) };
    const reader = createCacheReader();
    reader.register({ name: 'a', loader });
    const first = reader.get('a');
    pending.resolve(1);
    await first;
    await flush();
    await reader.get('a');
    expect(loader.load).toHaveBeenCalledTimes(1);
  });
});
