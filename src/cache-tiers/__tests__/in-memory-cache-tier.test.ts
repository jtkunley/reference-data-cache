import {
    CacheDomainAlreadyRegisteredError,
    CacheDomainNotRegisteredError,
} from '../../errors.js';
import { InMemoryCacheTier } from '../in-memory-cache-tier.js';

describe('InMemoryCacheTier', () => {
    it('returns what was previously stored with set', async () => {
        const tier = new InMemoryCacheTier();
        tier.register('k', { ttlMs: 60_000 });

        await tier.set('k', { n: 1 });
        await expect(tier.get<{ n: number }>('k')).resolves.toEqual({
            hit: true,
            value: { n: 1 },
        });
    });

    it('replaces an existing entry when set is called again', async () => {
        const tier = new InMemoryCacheTier();
        tier.register('k', { ttlMs: 60_000 });

        await tier.set('k', 'first');
        await tier.set('k', 'second');

        await expect(tier.get<string>('k')).resolves.toEqual({
            hit: true,
            value: 'second',
        });
    });

    it('stores null as a real value rather than a miss', async () => {
        const tier = new InMemoryCacheTier();
        tier.register('nullable', { ttlMs: 60_000 });

        await tier.set('nullable', null);
        await expect(tier.get<null>('nullable')).resolves.toEqual({
            hit: true,
            value: null,
        });
    });

    it('reports a miss for a registered domain that has nothing stored', async () => {
        const tier = new InMemoryCacheTier();
        tier.register('empty', { ttlMs: 1000 });

        await expect(tier.get('empty')).resolves.toEqual({ hit: false });
    });

    it('reports a miss after the entry is deleted', async () => {
        const tier = new InMemoryCacheTier();
        tier.register('k', { ttlMs: 60_000 });
        await tier.set('k', 'v');
        await tier.delete('k');

        await expect(tier.get<string>('k')).resolves.toEqual({ hit: false });
    });

    it('treats an entry past its TTL as a miss', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

        try {
            const tier = new InMemoryCacheTier();
            tier.register('k', { ttlMs: 1000 });
            await tier.set('k', 'fresh');

            vi.advanceTimersByTime(1001);

            await expect(tier.get<string>('k')).resolves.toEqual({
                hit: false,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('expires a zero-TTL entry as soon as the clock moves', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));

        try {
            const tier = new InMemoryCacheTier();
            tier.register('zero', { ttlMs: 0 });
            await tier.set('zero', 'gone');

            vi.advanceTimersByTime(0);

            await expect(tier.get<string>('zero')).resolves.toEqual({
                hit: false,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('applies the TTL of defaultPolicy when it is passed as the registration policy', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(10_000);

        try {
            const tier = new InMemoryCacheTier();
            tier.setDefaultPolicy({ ttlMs: 40 });
            tier.register('k', tier.defaultPolicy);
            await tier.set('k', 7);

            vi.advanceTimersByTime(41);

            await expect(tier.get<number>('k')).resolves.toEqual({
                hit: false,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('discards the stored value when a domain is unregistered', async () => {
        const tier = new InMemoryCacheTier();
        tier.register('k', { ttlMs: 60_000 });
        await tier.set('k', 'stale');

        tier.unregister('k');
        tier.register('k', { ttlMs: 60_000 });

        await expect(tier.get('k')).resolves.toEqual({ hit: false });
    });

    it('refuses a second registration of the same domain', () => {
        const tier = new InMemoryCacheTier();
        tier.register('d', { ttlMs: 1 });

        expect(() => tier.register('d', { ttlMs: 2 })).toThrow(
            CacheDomainAlreadyRegisteredError,
        );
    });

    it('rejects every operation on a domain that is not registered', async () => {
        const tier = new InMemoryCacheTier();

        await expect(tier.get('x')).rejects.toThrow(
            CacheDomainNotRegisteredError,
        );
        await expect(tier.set('x', 1)).rejects.toThrow(
            CacheDomainNotRegisteredError,
        );
        await expect(tier.delete('x')).rejects.toThrow(
            CacheDomainNotRegisteredError,
        );
    });

    it('has a static NAME identifier', () => {
        expect(InMemoryCacheTier.NAME).toBe('in-memory');
    });
});
