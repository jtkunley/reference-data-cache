import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CacheDomainAlreadyRegisteredError,
  CacheDomainNotRegisteredError,
  InMemoryCacheTier,
} from '../src/index.js';

describe('InMemoryCacheTier', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is named in-memory with a five-minute default', () => {
    expect(InMemoryCacheTier.NAME).toBe('in-memory');
    expect(new InMemoryCacheTier().defaultPolicy).toEqual({ ttlMs: 300_000 });
  });

  it('distinguishes misses from hits, including null and undefined', async () => {
    const tier = new InMemoryCacheTier();
    tier.register('a');
    await expect(tier.get('a')).resolves.toEqual({ hit: false });
    await tier.set('a', null);
    await expect(tier.get('a')).resolves.toEqual({ hit: true, value: null });
    await tier.set('a', undefined);
    await expect(tier.get('a')).resolves.toEqual({ hit: true, value: undefined });
  });

  it('expires entries at their TTL and restarts it on replacement', async () => {
    const tier = new InMemoryCacheTier();
    tier.register('a', { ttlMs: 100 });
    await tier.set('a', 1);
    vi.advanceTimersByTime(60);
    await tier.set('a', 2);
    vi.advanceTimersByTime(60);
    await expect(tier.get('a')).resolves.toEqual({ hit: true, value: 2 });
    vi.advanceTimersByTime(40);
    await expect(tier.get('a')).resolves.toEqual({ hit: false });
  });

  it('applies default-policy changes to future registrations only', async () => {
    const tier = new InMemoryCacheTier({ defaultPolicy: { ttlMs: 100 } });
    tier.register('a');
    tier.setDefaultPolicy({ ttlMs: 10 });
    tier.register('b');
    await tier.set('a', 1);
    await tier.set('b', 1);
    vi.advanceTimersByTime(50);
    await expect(tier.get('a')).resolves.toMatchObject({ hit: true });
    await expect(tier.get('b')).resolves.toEqual({ hit: false });
  });

  it('copies and freezes policies', () => {
    const policy = { ttlMs: 100 };
    const tier = new InMemoryCacheTier({ defaultPolicy: policy });
    policy.ttlMs = 5;
    expect(tier.defaultPolicy).toEqual({ ttlMs: 100 });
    expect(Object.isFrozen(tier.defaultPolicy)).toBe(true);
  });

  it('rejects duplicate registration and unregistered operations', async () => {
    const tier = new InMemoryCacheTier();
    tier.register('a');
    expect(() => {
      tier.register('a');
    }).toThrow(CacheDomainAlreadyRegisteredError);
    expect(() => {
      tier.register('a');
    }).toThrow(/^Cache: /);
    for (const op of [() => tier.get('x'), () => tier.set('x', 1), () => tier.delete('x')]) {
      await expect(op()).rejects.toBeInstanceOf(CacheDomainNotRegisteredError);
    }
  });

  it('keeps registration when deleting an absent value', async () => {
    const tier = new InMemoryCacheTier();
    tier.register('a');
    await expect(tier.delete('a')).resolves.toBeUndefined();
    await expect(tier.get('a')).resolves.toEqual({ hit: false });
  });

  it('unregisters names and values, ignoring unknown names', async () => {
    const tier = new InMemoryCacheTier();
    tier.register('a');
    await tier.set('a', 1);
    tier.unregister('a');
    tier.unregister('unknown');
    tier.register('a');
    await expect(tier.get('a')).resolves.toEqual({ hit: false });
  });

  it('does not keep a registration whose policy is invalid', () => {
    const tier = new InMemoryCacheTier();
    expect(() => {
      tier.register('a', { ttlMs: -1 });
    }).toThrow(RangeError);
    expect(() => {
      tier.register('a');
    }).not.toThrow();
  });
});
