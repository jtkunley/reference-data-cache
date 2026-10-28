import type { CacheDomain } from '../../contracts/common.js';
import { createCacheReader } from '../cache-reader.js';

describe('CacheReader: registration and expiry', () => {
    it('reloads once the in-memory entry has expired', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));

        try {
            const reader = createCacheReader();
            const load = vi
                .fn()
                .mockResolvedValueOnce('v1')
                .mockResolvedValueOnce('v2');

            reader.register({
                name: 'ttl',
                loader: { load },
                inMemoryPolicy: { ttlMs: 1000 },
            });

            await expect(reader.get<string>('ttl')).resolves.toBe('v1');
            expect(load).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(1001);

            await expect(reader.get<string>('ttl')).resolves.toBe('v2');
            expect(load).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('lets a domain-level inMemoryPolicy override a longer factory default', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));

        try {
            const reader = createCacheReader();
            const ttlMs = 1234;
            const load = vi
                .fn()
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(2);

            reader.register({
                name: 'n',
                loader: { load },
                inMemoryPolicy: { ttlMs },
            });

            await expect(reader.get<number>('n')).resolves.toBe(1);
            expect(load).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(ttlMs + 1);

            await expect(reader.get<number>('n')).resolves.toBe(2);
            expect(load).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects get for a domain that was never registered', async () => {
        const reader = createCacheReader();

        await expect(reader.get('missing')).rejects.toThrow(
            /CacheReader domain "missing" is not registered/,
        );
    });

    it('refuses a second registration of the same domain', () => {
        const reader = createCacheReader();
        const domain: CacheDomain<string> = {
            name: 'dup',
            loader: { load: vi.fn().mockResolvedValue('v') },
        };

        reader.register(domain);

        expect(() => reader.register(domain)).toThrow(
            /CacheReader domain "dup" is already registered/,
        );
    });
});

describe('CacheReader: loading', () => {
    it('registers a domain and serves it via the loader', async () => {
        const reader = createCacheReader();
        const load = vi.fn().mockResolvedValue({ version: 1 });

        const domain: CacheDomain<{ version: number }> = {
            name: 'config',
            loader: { load },
        };

        reader.register(domain);

        const first = await reader.get<{ version: number }>('config');
        const second = await reader.get<{ version: number }>('config');

        expect(first).toEqual({ version: 1 });
        expect(second).toEqual({ version: 1 });
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('shares one loader call across concurrent gets on an empty cache', async () => {
        const reader = createCacheReader();
        let resolveLoad!: (value: number) => void;
        const loadPromise = new Promise<number>((resolve) => {
            resolveLoad = resolve;
        });
        const load = vi.fn().mockReturnValue(loadPromise);

        reader.register({
            name: 'markets',
            loader: { load },
        });

        const pending = Promise.all([
            reader.get<number>('markets'),
            reader.get<number>('markets'),
            reader.get<number>('markets'),
        ]);

        resolveLoad!(7);

        const results = await pending;

        expect(results).toEqual([7, 7, 7]);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('keeps in-flight loads separate for each domain when several miss at once', async () => {
        const reader = createCacheReader();
        let resolveA!: (value: string) => void;
        let resolveB!: (value: string) => void;
        const promiseA = new Promise<string>((r) => {
            resolveA = r;
        });
        const promiseB = new Promise<string>((r) => {
            resolveB = r;
        });

        const loadA = vi.fn().mockReturnValue(promiseA);
        const loadB = vi.fn().mockReturnValue(promiseB);

        reader.register({
            name: 'a',
            loader: { load: loadA },
        });
        reader.register({
            name: 'b',
            loader: { load: loadB },
        });

        const pending = Promise.all([
            reader.get<string>('a'),
            reader.get<string>('a'),
            reader.get<string>('b'),
            reader.get<string>('b'),
        ]);

        resolveA!('A');
        resolveB!('B');

        await expect(pending).resolves.toEqual(['A', 'A', 'B', 'B']);
        expect(loadA).toHaveBeenCalledTimes(1);
        expect(loadB).toHaveBeenCalledTimes(1);
    });

    it('lets a later get retry after the loader rejects', async () => {
        const reader = createCacheReader();
        const load = vi
            .fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce('ok');

        reader.register({
            name: 'markets',
            loader: { load },
        });

        await expect(reader.get<string>('markets')).rejects.toThrow('boom');

        await expect(reader.get<string>('markets')).resolves.toBe('ok');
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('uses the inMemoryPolicy passed to the factory as the default TTL', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-02T00:00:00.000Z'));

        try {
            const ttlMs = 60_000;
            const reader = createCacheReader({
                inMemoryPolicy: { ttlMs },
            });

            const load = vi
                .fn()
                .mockResolvedValueOnce('a')
                .mockResolvedValueOnce('b');
            reader.register({
                name: 'x',
                loader: { load },
            });

            await expect(reader.get<string>('x')).resolves.toBe('a');
            expect(load).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(ttlMs + 1);

            await expect(reader.get<string>('x')).resolves.toBe('b');
            expect(load).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects a loader result of undefined', async () => {
        const reader = createCacheReader();
        const load = vi.fn().mockResolvedValue(undefined);

        reader.register({
            name: 'bad',
            loader: { load },
        });

        await expect(reader.get<string>('bad')).rejects.toThrow(
            /loader for domain "bad" resolved to undefined/,
        );
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('rejects a loader result of null', async () => {
        const reader = createCacheReader();
        const load = vi.fn().mockResolvedValue(null);

        reader.register({
            name: 'bad',
            loader: { load },
        });

        await expect(reader.get<string>('bad')).rejects.toThrow(
            /loader for domain "bad" resolved to null/,
        );
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('refuses an invalid TTL in the factory options or on a domain', () => {
        expect(() =>
            createCacheReader({ inMemoryPolicy: { ttlMs: Number.NaN } }),
        ).toThrow(RangeError);

        const reader = createCacheReader();
        expect(() =>
            reader.register({
                name: 'neg',
                loader: { load: vi.fn() },
                inMemoryPolicy: { ttlMs: -5 },
            }),
        ).toThrow(/Invalid TTL for domain "neg"/);
        expect(() =>
            reader.register({ name: 'neg', loader: { load: vi.fn() } }),
        ).not.toThrow();
    });
});
