import { describe, expect, it, vi } from 'vitest';
import {
  CacheDomainAlreadyRegisteredError,
  CacheDomainNotRegisteredError,
  CacheTierCorruptValueError,
  CacheTierSerializationError,
  CacheTierTimeoutError,
  InMemoryCacheTier,
  RedisCacheTier,
  createCacheOwner,
  type CacheTier,
  type CacheTierErrorEvent,
} from '../src/index.js';
import { FakeRedis, deferred, flush, loaderOf } from './helpers.js';

function setup(tier: CacheTier = new InMemoryCacheTier()) {
  const events: CacheTierErrorEvent[] = [];
  const owner = createCacheOwner({
    sharedTier: tier,
    onTierError: (event) => {
      events.push(event);
    },
  });
  return { owner, tier, events };
}

describe('createCacheOwner', () => {
  describe('registration', () => {
    it('requires a shared tier', () => {
      expect(() => createCacheOwner({} as never)).toThrow(TypeError);
    });

    it('registers with the shared tier without reading or writing it', () => {
      const tier = new InMemoryCacheTier();
      const spies = [vi.spyOn(tier, 'get'), vi.spyOn(tier, 'set'), vi.spyOn(tier, 'delete')];
      const loader = loaderOf(() => 1);
      createCacheOwner({ sharedTier: tier }).register({ name: 'a', loader });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(loader.load).not.toHaveBeenCalled();
    });

    it('rejects duplicates naming the owner', () => {
      const { owner } = setup();
      owner.register({ name: 'a', loader: loaderOf(() => 1) });
      expect(() => {
        owner.register({ name: 'a', loader: loaderOf(() => 1) });
      }).toThrow(new CacheDomainAlreadyRegisteredError('a', 'CacheOwner').message);
    });

    it('rejects a local TTL longer than the shared TTL, allowing equal TTLs', () => {
      const { owner } = setup(new InMemoryCacheTier({ defaultPolicy: { ttlMs: 1_000 } }));
      expect(() => {
        owner.register({ name: 'a', loader: loaderOf(() => 1) });
      }).toThrow(RangeError);
      expect(() => {
        owner.register({ name: 'a', loader: loaderOf(() => 1), inMemoryPolicy: { ttlMs: 1_000 } });
      }).not.toThrow();
      expect(() => {
        owner.register({
          name: 'b',
          loader: loaderOf(() => 1),
          inMemoryPolicy: { ttlMs: 5_000 },
          sharedPolicy: { ttlMs: 5_000 },
        });
      }).not.toThrow();
    });

    it("uses the tier's default policy as of registration", async () => {
      const redis = new FakeRedis();
      const tier = new RedisCacheTier(redis);
      const { owner } = setup(tier);
      tier.setDefaultPolicy({ ttlMs: 600_000 });
      owner.register({ name: 'a', loader: loaderOf(() => 1) });
      tier.setDefaultPolicy({ ttlMs: 900_000 });
      await owner.get('a');
      await flush();
      expect(redis.set).toHaveBeenCalledWith('reference-data-cache:v1:a', '1', 600_000);
    });

    it('stays unregistered when the shared tier rejects the policy', () => {
      const tier = new RedisCacheTier(new FakeRedis());
      const { owner } = setup(tier);
      const loader = loaderOf(() => 1);
      expect(() => {
        owner.register({ name: 'a', loader, sharedPolicy: { ttlMs: 300_000.5 } });
      }).toThrow(RangeError);
      expect(() => {
        owner.register({ name: 'a', loader, sharedPolicy: { ttlMs: 300_000 } });
      }).not.toThrow();
    });
  });

  describe('reads', () => {
    it('rejects reads of unknown domains', async () => {
      const { owner } = setup();
      await expect(owner.get('nope')).rejects.toBeInstanceOf(CacheDomainNotRegisteredError);
    });

    it('serves local hits without touching the shared tier or loader', async () => {
      const { owner, tier } = setup();
      const loader = loaderOf(() => 1);
      owner.register({ name: 'a', loader });
      await owner.get('a');
      const get = vi.spyOn(tier, 'get');
      await owner.get('a');
      expect(get).not.toHaveBeenCalled();
      expect(loader.load).toHaveBeenCalledTimes(1);
    });

    it('promotes shared hits to local cache without loading', async () => {
      const { owner, tier } = setup();
      const loader = loaderOf(() => 'fresh');
      owner.register({ name: 'a', loader });
      await tier.set('a', 'shared');
      await expect(owner.get('a')).resolves.toBe('shared');
      await tier.delete('a');
      await expect(owner.get('a')).resolves.toBe('shared');
      expect(loader.load).not.toHaveBeenCalled();
    });

    it('accepts shared hits of null as supplied', async () => {
      const { owner, tier } = setup();
      owner.register({ name: 'a', loader: loaderOf(() => 1) });
      await tier.set('a', null);
      await expect(owner.get('a')).resolves.toBeNull();
    });

    it('loads on a shared miss, populates both tiers, and returns before the shared write settles', async () => {
      const { owner, tier } = setup();
      const write = deferred<undefined>();
      const set = vi.spyOn(tier, 'set').mockReturnValue(write.promise);
      owner.register({ name: 'a', loader: loaderOf(() => 42) });
      await expect(owner.get('a')).resolves.toBe(42);
      expect(set).toHaveBeenCalledWith('a', 42);
      write.resolve(undefined);
    });

    it('shares the shared read and load between concurrent misses', async () => {
      const { owner, tier } = setup();
      const get = vi.spyOn(tier, 'get');
      const loader = loaderOf(() => 'v');
      owner.register({ name: 'a', loader });
      const values = await Promise.all([owner.get('a'), owner.get('a'), owner.get('a')]);
      expect(values).toEqual(['v', 'v', 'v']);
      expect(get).toHaveBeenCalledTimes(1);
      expect(loader.load).toHaveBeenCalledTimes(1);
    });

    it('falls back to the loader when the shared read fails, reporting once', async () => {
      const { owner, tier, events } = setup();
      const failure = new Error('redis down');
      vi.spyOn(tier, 'get').mockRejectedValue(failure);
      owner.register({ name: 'a', loader: loaderOf(() => 'v') });
      await Promise.all([owner.get('a'), owner.get('a')]);
      expect(events).toEqual([
        { domain: 'a', tier: 'shared', operation: 'get', kind: 'error', error: failure },
      ]);
    });

    it('treats synchronous tier throws like rejections', async () => {
      const { owner, tier, events } = setup();
      const failure = new Error('sync');
      vi.spyOn(tier, 'get').mockImplementation(() => {
        throw failure;
      });
      vi.spyOn(tier, 'set').mockImplementation(() => {
        throw failure;
      });
      owner.register({ name: 'a', loader: loaderOf(() => 'v') });
      await expect(owner.get('a')).resolves.toBe('v');
      await flush();
      expect(events.map((e) => e.operation)).toEqual(['get', 'set']);
    });

    it('keeps a successful read and its local value when the shared write fails', async () => {
      const { owner, tier, events } = setup();
      const failure = new Error('write failed');
      vi.spyOn(tier, 'set').mockRejectedValue(failure);
      const loader = loaderOf(() => 'v');
      owner.register({ name: 'a', loader });
      await expect(owner.get('a')).resolves.toBe('v');
      await flush();
      await expect(owner.get('a')).resolves.toBe('v');
      expect(loader.load).toHaveBeenCalledTimes(1);
      expect(events).toMatchObject([{ operation: 'set', kind: 'error', error: failure }]);
    });

    it('does not report loader failures or ordinary misses as tier errors', async () => {
      const { owner, events } = setup();
      const failure = new Error('source down');
      owner.register({
        name: 'a',
        loader: {
          load: () => Promise.reject(failure),
        },
      });
      await expect(owner.get('a')).rejects.toBe(failure);
      expect(events).toEqual([]);
    });

    it('rejects null loader results and does not write them to the shared tier', async () => {
      const { owner, tier } = setup();
      const set = vi.spyOn(tier, 'set');
      owner.register({ name: 'a', loader: loaderOf(() => null) });
      await expect(owner.get('a')).rejects.toThrow(/CacheOwner.*"a".*null/);
      expect(set).not.toHaveBeenCalled();
    });

    it('reports serialization failures without failing the read', async () => {
      const redis = new FakeRedis();
      const { owner, events } = setup(new RedisCacheTier(redis));
      owner.register({ name: 'a', loader: loaderOf(() => ({ big: 1n })) });
      await expect(owner.get('a')).resolves.toEqual({ big: 1n });
      await flush();
      expect(redis.set).not.toHaveBeenCalled();
      expect(events).toMatchObject([{ operation: 'set', kind: 'serialize' }]);
      expect(events[0]!.error).toBeInstanceOf(CacheTierSerializationError);
    });

    it('classifies shared timeouts', async () => {
      const redis = new FakeRedis();
      redis.get.mockReturnValue(new Promise(() => undefined));
      const { owner, events } = setup(new RedisCacheTier(redis, { operationTimeoutMs: 5 }));
      owner.register({ name: 'a', loader: loaderOf(() => 'v') });
      await expect(owner.get('a')).resolves.toBe('v');
      expect(events).toMatchObject([{ operation: 'get', kind: 'timeout' }]);
      expect(events[0]!.error).toBeInstanceOf(CacheTierTimeoutError);
    });
  });

  describe('corrupt shared values', () => {
    it('reports, deletes in the background, and loads fresh data', async () => {
      const redis = new FakeRedis();
      redis.data.set('reference-data-cache:v1:a', { value: '{oops', ttlMs: 1 });
      const removal = deferred<undefined>();
      redis.delete.mockReturnValueOnce(removal.promise);
      const { owner, events } = setup(new RedisCacheTier(redis));
      owner.register({ name: 'a', loader: loaderOf(() => 'fresh') });
      await expect(owner.get('a')).resolves.toBe('fresh');
      expect(redis.delete).toHaveBeenCalledWith('reference-data-cache:v1:a');
      expect(events).toMatchObject([{ operation: 'get', kind: 'corrupt-value' }]);
      expect(events[0]!.error).toBeInstanceOf(CacheTierCorruptValueError);
      removal.resolve(undefined);
    });

    it('reports a failed background deletion separately', async () => {
      const redis = new FakeRedis();
      redis.data.set('reference-data-cache:v1:a', { value: 'not json', ttlMs: 1 });
      const failure = new Error('del failed');
      redis.delete.mockRejectedValueOnce(failure);
      const { owner, events } = setup(new RedisCacheTier(redis));
      owner.register({ name: 'a', loader: loaderOf(() => 'fresh') });
      await expect(owner.get('a')).resolves.toBe('fresh');
      await flush();
      expect(events.map((e) => [e.operation, e.kind])).toEqual([
        ['get', 'corrupt-value'],
        ['delete', 'error'],
      ]);
      expect(events[1]!.error).toBe(failure);
    });
  });

  describe('onTierError', () => {
    it('contains hook throws and rejections', async () => {
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        for (const hook of [
          () => {
            throw new Error('hook threw');
          },
          () => Promise.reject(new Error('hook rejected')),
        ]) {
          const tier = new InMemoryCacheTier();
          vi.spyOn(tier, 'get').mockRejectedValue(new Error('down'));
          const owner = createCacheOwner({ sharedTier: tier, onTierError: hook });
          owner.register({ name: 'a', loader: loaderOf(() => 'v') });
          await expect(owner.get('a')).resolves.toBe('v');
        }
        await flush();
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });

    it('preserves non-Error failure values', async () => {
      const { owner, tier, events } = setup();
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      vi.spyOn(tier, 'get').mockReturnValue(Promise.reject('plain string'));
      owner.register({ name: 'a', loader: loaderOf(() => 'v') });
      await owner.get('a');
      expect(events).toMatchObject([{ kind: 'error', error: 'plain string' }]);
    });
  });
});
