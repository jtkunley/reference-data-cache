import { describe, expect, it, vi } from 'vitest';
import {
  CacheDomainNotRegisteredError,
  InMemoryCacheTier,
  createCacheOwner,
  type CacheTierErrorEvent,
} from '../../src/index.js';
import { deferred, flush, loaderOf } from '../support/helpers.js';

function setup() {
  const tier = new InMemoryCacheTier();
  const events: CacheTierErrorEvent[] = [];
  const owner = createCacheOwner({
    sharedTier: tier,
    onTierError: (event) => {
      events.push(event);
    },
  });
  let version = 0;
  const loader = loaderOf(() => {
    version += 1;
    return `v${String(version)}`;
  });
  owner.register({ name: 'a', loader });
  return { owner, tier, events, loader };
}

describe('CacheOwner.invalidate', () => {
  it('rejects unknown domains', async () => {
    const { owner } = setup();
    await expect(owner.invalidate('nope')).rejects.toBeInstanceOf(CacheDomainNotRegisteredError);
  });

  it('clears both tiers so the next read loads', async () => {
    const { owner, tier, loader } = setup();
    await expect(owner.get('a')).resolves.toBe('v1');
    await flush();
    await owner.invalidate('a');
    await expect(tier.get('a')).resolves.toEqual({ hit: false });
    await expect(owner.get('a')).resolves.toBe('v2');
    expect(loader.load).toHaveBeenCalledTimes(2);
  });

  it('clears the local value before waiting for the shared delete', async () => {
    const { owner, tier, loader } = setup();
    await owner.get('a');
    await flush();
    const removal = deferred<undefined>();
    vi.spyOn(tier, 'delete').mockReturnValueOnce(removal.promise);
    vi.spyOn(tier, 'get').mockResolvedValueOnce({ hit: false });
    const invalidation = owner.invalidate('a');
    await expect(owner.get('a')).resolves.toBe('v2');
    expect(loader.load).toHaveBeenCalledTimes(2);
    removal.resolve(undefined);
    await invalidation;
  });

  it('discards local values refilled while the shared delete was pending', async () => {
    const { owner, tier, loader } = setup();
    await owner.get('a');
    await flush();
    const removal = deferred<undefined>();
    const remove = tier.delete.bind(tier);
    vi.spyOn(tier, 'delete').mockImplementationOnce(async (name) => {
      await removal.promise;
      await remove(name);
    });
    const get = vi.spyOn(tier, 'get');
    const invalidation = owner.invalidate('a');
    await expect(owner.get('a')).resolves.toBe('v1');
    removal.resolve(undefined);
    await invalidation;
    await expect(owner.get('a')).resolves.toBe('v2');
    expect(get).toHaveBeenCalledTimes(2);
    expect(loader.load).toHaveBeenCalledTimes(2);
  });

  it('rejects with the delete failure, reports it, and still clears locally', async () => {
    const { owner, tier, events, loader } = setup();
    await owner.get('a');
    await flush();
    const failure = new Error('del failed');
    vi.spyOn(tier, 'delete').mockRejectedValueOnce(failure);
    await expect(owner.invalidate('a')).rejects.toBe(failure);
    expect(events).toMatchObject([{ operation: 'delete', kind: 'error', error: failure }]);
    vi.spyOn(tier, 'get').mockResolvedValueOnce({ hit: false });
    await expect(owner.get('a')).resolves.toBe('v2');
    expect(loader.load).toHaveBeenCalledTimes(2);
  });

  it('detaches later misses from a refresh already in flight and blocks its population', async () => {
    const tier = new InMemoryCacheTier();
    const owner = createCacheOwner({ sharedTier: tier });
    const first = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue('new');
    owner.register({ name: 'a', loader: { load } });
    const set = vi.spyOn(tier, 'set');

    const early = owner.get('a');
    await flush();
    await owner.invalidate('a');
    const late = owner.get('a');
    first.resolve('old');

    await expect(early).resolves.toBe('old');
    await expect(late).resolves.toBe('new');
    expect(load).toHaveBeenCalledTimes(2);
    await flush();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('a', 'new');
    await expect(owner.get('a')).resolves.toBe('new');
  });

  it('skips the loader in a superseded refresh once a newer refresh filled local cache', async () => {
    const tier = new InMemoryCacheTier();
    const owner = createCacheOwner({ sharedTier: tier });
    const load = vi.fn().mockResolvedValue('new');
    owner.register({ name: 'a', loader: { load } });
    const slowRead = deferred<{ hit: false }>();
    vi.spyOn(tier, 'get').mockReturnValueOnce(slowRead.promise);

    const early = owner.get('a');
    await owner.invalidate('a');
    await expect(owner.get('a')).resolves.toBe('new');
    slowRead.resolve({ hit: false });

    await expect(early).resolves.toBe('new');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('resolves overlapping invalidations according to their own deletes', async () => {
    const { owner, tier } = setup();
    const failure = new Error('first failed');
    const firstDelete = deferred<undefined>();
    vi.spyOn(tier, 'delete')
      .mockReturnValueOnce(firstDelete.promise)
      .mockResolvedValueOnce(undefined);
    const first = owner.invalidate('a');
    const second = owner.invalidate('a');
    await expect(second).resolves.toBeUndefined();
    firstDelete.reject(failure);
    await expect(first).rejects.toBe(failure);
  });

  it('leaves other clients with their local values', async () => {
    const tier = new InMemoryCacheTier();
    const owner = createCacheOwner({ sharedTier: tier });
    owner.register({ name: 'a', loader: loaderOf(() => 'one') });
    const otherTier = new InMemoryCacheTier();
    const other = createCacheOwner({ sharedTier: otherTier });
    other.register({ name: 'a', loader: loaderOf(() => 'two') });
    await Promise.all([owner.get('a'), other.get('a')]);
    await owner.invalidate('a');
    await expect(other.get('a')).resolves.toBe('two');
  });
});
