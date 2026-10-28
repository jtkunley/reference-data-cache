import type { CacheDomain, SharedCacheClient } from '../../contracts/common.js';
import {
    CacheDomainAlreadyRegisteredError,
    CacheDomainNotRegisteredError,
    CacheTierCorruptValueError,
    CacheTierTimeoutError,
} from '../../errors.js';
import { InMemoryCacheTier } from '../../cache-tiers/in-memory-cache-tier.js';
import { RedisCacheTier } from '../../cache-tiers/redis/redis-cache-tier.js';
import { createCacheOwner } from '../cache-owner.js';

const never = () => new Promise<never>(() => undefined);

function redisBackedOwner(client: Partial<SharedCacheClient>) {
    const shared: SharedCacheClient = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        ...client,
    };
    const onTierError = vi.fn();
    const owner = createCacheOwner({
        sharedTier: new RedisCacheTier(shared, { operationTimeoutMs: 100 }),
        onTierError,
    });
    const load = vi.fn().mockResolvedValue({ id: 'fresh' });
    owner.register({ name: 'd', loader: { load } });
    return { owner, shared, load, onTierError };
}

describe('CacheOwner: core behaviour', () => {
    it('calls the loader only once while the value is still in L1', async () => {
        const shared = new InMemoryCacheTier();
        shared.setDefaultPolicy({ ttlMs: 60 * 60_000 });
        const owner = createCacheOwner({ sharedTier: shared });
        const load = vi.fn().mockResolvedValue({ id: 'a' });

        owner.register({
            name: 'd',
            loader: { load },
        });

        const first = await owner.get<{ id: string }>('d');
        const second = await owner.get<{ id: string }>('d');

        expect(first).toEqual({ id: 'a' });
        expect(second).toEqual({ id: 'a' });
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('refills an expired L1 from a still-valid L2 entry', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));

        try {
            const shared = new InMemoryCacheTier();
            shared.setDefaultPolicy({ ttlMs: 60 * 60_000 });
            const owner = createCacheOwner({
                sharedTier: shared,
                inMemoryPolicy: { ttlMs: 500 },
            });
            const load = vi.fn().mockResolvedValue('payload');

            owner.register({
                name: 'd',
                loader: { load },
                sharedPolicy: { ttlMs: 60 * 60_000 },
            });

            await owner.get<string>('d');
            expect(load).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(501);

            const second = await owner.get<string>('d');

            expect(second).toBe('payload');
            expect(load).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('shares one loader call across concurrent gets when both tiers are empty', async () => {
        const shared = new InMemoryCacheTier();
        shared.setDefaultPolicy({ ttlMs: 60 * 60_000 });
        const owner = createCacheOwner({ sharedTier: shared });
        let resolveLoad!: (value: { id: string }) => void;
        const loadPromise = new Promise<{ id: string }>((resolve) => {
            resolveLoad = resolve;
        });
        const load = vi.fn().mockReturnValue(loadPromise);

        owner.register({
            name: 'markets',
            loader: { load },
        });

        const pending = Promise.all([
            owner.get<{ id: string }>('markets'),
            owner.get<{ id: string }>('markets'),
            owner.get<{ id: string }>('markets'),
        ]);

        resolveLoad({ id: 'x' });

        const results = await pending;

        expect(results).toEqual([{ id: 'x' }, { id: 'x' }, { id: 'x' }]);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('shares one loader call across concurrent gets after L1 expires with L2 empty', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));

        try {
            const shared = new InMemoryCacheTier();
            shared.setDefaultPolicy({ ttlMs: 60 * 60_000 });
            const owner = createCacheOwner({
                sharedTier: shared,
                inMemoryPolicy: { ttlMs: 500 },
            });
            const load = vi.fn();

            owner.register({
                name: 'markets',
                loader: { load },
                sharedPolicy: { ttlMs: 60 * 60_000 },
            });

            load.mockResolvedValueOnce({ id: 'warm' });
            await owner.get<{ id: string }>('markets');
            expect(load).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(501);
            await shared.delete('markets');

            let resolveBurst!: (value: { id: string }) => void;
            const burstPromise = new Promise<{ id: string }>((resolve) => {
                resolveBurst = resolve;
            });
            load.mockReturnValue(burstPromise);

            const pending = Promise.all([
                owner.get<{ id: string }>('markets'),
                owner.get<{ id: string }>('markets'),
                owner.get<{ id: string }>('markets'),
            ]);

            resolveBurst({ id: 'burst' });

            const results = await pending;

            expect(results).toEqual([
                { id: 'burst' },
                { id: 'burst' },
                { id: 'burst' },
            ]);
            expect(load).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('lets a later get retry after the loader rejects', async () => {
        const shared = new InMemoryCacheTier();
        shared.setDefaultPolicy({ ttlMs: 60 * 60_000 });
        const owner = createCacheOwner({ sharedTier: shared });
        const load = vi
            .fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({ ok: true });

        owner.register({
            name: 'markets',
            loader: { load },
        });

        await expect(owner.get<{ ok: boolean }>('markets')).rejects.toThrow(
            'boom',
        );

        await expect(owner.get<{ ok: boolean }>('markets')).resolves.toEqual({
            ok: true,
        });
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('uses the loader when reading the shared tier fails', async () => {
        const shared = new InMemoryCacheTier();
        shared.setDefaultPolicy({ ttlMs: 60 * 60_000 });
        const owner = createCacheOwner({ sharedTier: shared });

        owner.register({
            name: 'd',
            loader: { load: vi.fn().mockResolvedValue('loaded') },
        });

        vi.spyOn(shared, 'get').mockRejectedValueOnce(new Error('shared down'));

        await expect(owner.get('d')).resolves.toBe('loaded');
    });

    it('uses the inMemoryPolicy passed to the factory as the default L1 TTL', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));

        try {
            const ttlMs = 45_000;
            const shared = new InMemoryCacheTier();
            shared.setDefaultPolicy({ ttlMs: 60 * 60_000 });
            const owner = createCacheOwner({
                sharedTier: shared,
                inMemoryPolicy: { ttlMs },
            });

            const load = vi
                .fn()
                .mockResolvedValueOnce(0)
                .mockResolvedValueOnce(1);

            owner.register({
                name: 'x',
                loader: { load },
                sharedPolicy: { ttlMs },
            });

            await expect(owner.get<number>('x')).resolves.toBe(0);
            expect(load).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(ttlMs + 1);

            await expect(owner.get<number>('x')).resolves.toBe(1);
            expect(load).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('accepts an in-memory TTL equal to the shared TTL', () => {
        const shared = new InMemoryCacheTier();
        shared.setDefaultPolicy({ ttlMs: 5000 });
        const owner = createCacheOwner({ sharedTier: shared });

        expect(() =>
            owner.register({
                name: 'edge',
                loader: { load: vi.fn() },
                inMemoryPolicy: { ttlMs: 5000 },
            }),
        ).not.toThrow();
    });

    it('refuses an in-memory TTL longer than the shared TTL', () => {
        const shared = new InMemoryCacheTier();
        shared.setDefaultPolicy({ ttlMs: 1000 });
        const owner = createCacheOwner({ sharedTier: shared });

        expect(() =>
            owner.register({
                name: 'bad',
                loader: { load: vi.fn() },
                inMemoryPolicy: { ttlMs: 2000 },
            }),
        ).toThrow(
            /CacheOwner domain "bad" has invalid policy configuration: in-memory TTL must be less than or equal to shared TTL/,
        );
    });

    it('refuses a second registration of the same domain', () => {
        const shared = new InMemoryCacheTier();
        const owner = createCacheOwner({ sharedTier: shared });
        const domain: CacheDomain<number> = {
            name: 'dup',
            loader: { load: vi.fn().mockResolvedValue(1) },
        };

        owner.register(domain);

        expect(() => owner.register(domain)).toThrow(
            /CacheOwner domain "dup" is already registered/,
        );
        expect(() => owner.register(domain)).toThrow(
            CacheDomainAlreadyRegisteredError,
        );
    });

    it('leaves no partial registration when the shared tier refuses a domain', async () => {
        const shared = new InMemoryCacheTier();
        const owner = createCacheOwner({ sharedTier: shared });
        vi.spyOn(shared, 'register').mockImplementationOnce(() => {
            throw new Error('shared tier refused');
        });
        const domain: CacheDomain<string> = {
            name: 'd',
            loader: { load: vi.fn().mockResolvedValue('value') },
        };

        expect(() => owner.register(domain)).toThrow('shared tier refused');
        await expect(owner.get('d')).rejects.toThrow(/is not registered/);

        expect(() => owner.register(domain)).not.toThrow();
        await expect(owner.get<string>('d')).resolves.toBe('value');
    });

    it('rejects get for a domain that was never registered', async () => {
        const shared = new InMemoryCacheTier();
        const owner = createCacheOwner({ sharedTier: shared });

        await expect(owner.get('missing')).rejects.toThrow(
            /CacheOwner domain "missing" is not registered/,
        );
        await expect(owner.invalidate('missing')).rejects.toBeInstanceOf(
            CacheDomainNotRegisteredError,
        );
    });

    it('invalidate empties both tiers, forcing the next get to reload', async () => {
        const shared = new InMemoryCacheTier();
        shared.setDefaultPolicy({ ttlMs: 60 * 60_000 });
        const owner = createCacheOwner({ sharedTier: shared });
        const load = vi
            .fn()
            .mockResolvedValueOnce({ v: 1 })
            .mockResolvedValueOnce({ v: 2 });

        owner.register({ name: 'data', loader: { load } });

        await expect(owner.get<{ v: number }>('data')).resolves.toEqual({
            v: 1,
        });
        expect(load).toHaveBeenCalledTimes(1);

        await owner.invalidate('data');

        await expect(owner.get<{ v: number }>('data')).resolves.toEqual({
            v: 2,
        });
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('invalidate stops a load already in progress from caching its result', async () => {
        const shared = new InMemoryCacheTier();
        shared.setDefaultPolicy({ ttlMs: 60 * 60_000 });
        const owner = createCacheOwner({ sharedTier: shared });
        const resolvers: Array<(value: string) => void> = [];
        const load = vi.fn(
            () => new Promise<string>((resolve) => resolvers.push(resolve)),
        );
        owner.register({ name: 'd', loader: { load } });

        const startedBefore = owner.get<string>('d');
        await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
        await owner.invalidate('d');

        const startedAfter = owner.get<string>('d');
        await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));

        resolvers[0]('old');
        await expect(startedBefore).resolves.toBe('old');

        const joinsNewLoad = owner.get<string>('d');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(load).toHaveBeenCalledTimes(2);

        resolvers[1]('new');
        await expect(startedAfter).resolves.toBe('new');
        await expect(joinsNewLoad).resolves.toBe('new');

        expect(load).toHaveBeenCalledTimes(2);
        await expect(owner.get<string>('d')).resolves.toBe('new');
        await expect(shared.get('d')).resolves.toEqual({
            hit: true,
            value: 'new',
        });
    });

    it('invalidate stops an L2 read already in progress from refilling L1', async () => {
        let finishRead!: (value: string | null) => void;
        const { owner, shared, load } = redisBackedOwner({
            get: vi.fn(
                () =>
                    new Promise<string | null>(
                        (resolve) => (finishRead = resolve),
                    ),
            ),
        });

        const reading = owner.get('d');
        await vi.waitFor(() => expect(shared.get).toHaveBeenCalled());
        await owner.invalidate('d');
        finishRead(JSON.stringify({ id: 'old' }));
        await expect(reading).resolves.toEqual({ id: 'old' });

        vi.mocked(shared.get).mockResolvedValue(null);
        await expect(owner.get('d')).resolves.toEqual({ id: 'fresh' });
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('invalidate rejects a domain that was never registered', async () => {
        const shared = new InMemoryCacheTier();
        const owner = createCacheOwner({ sharedTier: shared });

        await expect(owner.invalidate('missing')).rejects.toThrow(
            /CacheOwner domain "missing" is not registered/,
        );
    });

    it('rejects a loader result of undefined', async () => {
        const shared = new InMemoryCacheTier();
        shared.setDefaultPolicy({ ttlMs: 60 * 60_000 });
        const owner = createCacheOwner({ sharedTier: shared });
        const load = vi.fn().mockResolvedValue(undefined);

        owner.register({
            name: 'bad',
            loader: { load },
        });

        await expect(owner.get<string>('bad')).rejects.toThrow(
            /loader for domain "bad" resolved to undefined/,
        );
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('rejects a loader result of null', async () => {
        const shared = new InMemoryCacheTier();
        shared.setDefaultPolicy({ ttlMs: 60 * 60_000 });
        const owner = createCacheOwner({ sharedTier: shared });
        const load = vi.fn().mockResolvedValue(null);

        owner.register({
            name: 'bad',
            loader: { load },
        });

        await expect(owner.get<string>('bad')).rejects.toThrow(
            /loader for domain "bad" resolved to null/,
        );
        expect(load).toHaveBeenCalledTimes(1);
    });
});

describe('CacheOwner: shared-tier failures', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('reports nothing when the shared tier behaves', async () => {
        const { owner, onTierError } = redisBackedOwner({});

        await owner.get('d');
        await owner.invalidate('d');
        await owner.get('d');

        expect(onTierError).not.toHaveBeenCalled();
    });

    it('loads from source when the L2 read rejects, then answers from L1', async () => {
        const { owner, load, onTierError } = redisBackedOwner({
            get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        });

        await expect(owner.get('d')).resolves.toEqual({ id: 'fresh' });
        await expect(owner.get('d')).resolves.toEqual({ id: 'fresh' });
        expect(load).toHaveBeenCalledTimes(1);
        expect(onTierError).toHaveBeenCalledWith(
            expect.objectContaining({
                domain: 'd',
                tier: 'shared',
                operation: 'get',
                kind: 'error',
            }),
        );
    });

    it('loads from source when the L2 read hangs', async () => {
        vi.useFakeTimers();
        const { owner, load, onTierError } = redisBackedOwner({
            get: vi.fn(never),
        });

        const pending = owner.get('d');
        await vi.advanceTimersByTimeAsync(100);

        await expect(pending).resolves.toEqual({ id: 'fresh' });
        expect(load).toHaveBeenCalledTimes(1);
        expect(onTierError).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: 'get',
                kind: 'timeout',
                error: expect.any(CacheTierTimeoutError),
            }),
        );
    });

    it('calls the loader once even when concurrent L2 reads time out at different times', async () => {
        vi.useFakeTimers();
        const { owner, load } = redisBackedOwner({ get: vi.fn(never) });

        const first = owner.get('d');
        await vi.advanceTimersByTimeAsync(20);
        const second = owner.get('d');
        await vi.advanceTimersByTimeAsync(100);

        await expect(first).resolves.toEqual({ id: 'fresh' });
        await expect(second).resolves.toEqual({ id: 'fresh' });
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('still returns the value and caches it in L1 when the L2 write fails', async () => {
        const { owner, load, onTierError } = redisBackedOwner({
            set: vi.fn().mockRejectedValue(new Error('OOM')),
        });

        await expect(owner.get('d')).resolves.toEqual({ id: 'fresh' });
        await expect(owner.get('d')).resolves.toEqual({ id: 'fresh' });
        expect(load).toHaveBeenCalledTimes(1);
        await vi.waitFor(() =>
            expect(onTierError).toHaveBeenCalledWith(
                expect.objectContaining({ operation: 'set', kind: 'error' }),
            ),
        );
    });

    it('does not block on a slow L2 write, which later reports a timeout', async () => {
        vi.useFakeTimers();
        const { owner, onTierError } = redisBackedOwner({
            set: vi.fn(never),
        });

        await expect(owner.get('d')).resolves.toEqual({ id: 'fresh' });
        expect(onTierError).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(100);
        expect(onTierError).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'set', kind: 'timeout' }),
        );
    });

    it('keeps an unserializable value in L1 and reports a set/serialize error', async () => {
        const { owner, shared, load, onTierError } = redisBackedOwner({});
        load.mockResolvedValue({ big: 1n });

        await expect(owner.get('d')).resolves.toEqual({ big: 1n });
        await expect(owner.get('d')).resolves.toEqual({ big: 1n });
        expect(load).toHaveBeenCalledTimes(1);
        expect(shared.set).not.toHaveBeenCalled();
        await vi.waitFor(() =>
            expect(onTierError).toHaveBeenCalledWith(
                expect.objectContaining({
                    operation: 'set',
                    kind: 'serialize',
                }),
            ),
        );
    });

    it('replaces a corrupt L2 entry with a freshly loaded value', async () => {
        const { owner, shared, load, onTierError } = redisBackedOwner({
            get: vi.fn().mockResolvedValue('{bad'),
        });

        await expect(owner.get('d')).resolves.toEqual({ id: 'fresh' });
        expect(shared.delete).toHaveBeenCalledTimes(1);
        expect(shared.set).toHaveBeenCalledWith(
            expect.any(String),
            JSON.stringify({ id: 'fresh' }),
            expect.any(Number),
        );
        expect(load).toHaveBeenCalledTimes(1);
        expect(onTierError).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: 'get',
                kind: 'corrupt-value',
            }),
        );
    });

    it('reloads past a corrupt L2 entry even if deleting it fails, reporting both errors in sequence', async () => {
        const deleteError = new Error('down');
        const { owner, onTierError } = redisBackedOwner({
            get: vi.fn().mockResolvedValue('{bad'),
            delete: vi.fn().mockRejectedValue(deleteError),
        });

        await expect(owner.get('d')).resolves.toEqual({ id: 'fresh' });
        await vi.waitFor(() =>
            expect(onTierError.mock.calls.map(([event]) => event)).toEqual([
                expect.objectContaining({
                    operation: 'get',
                    kind: 'corrupt-value',
                    error: expect.any(CacheTierCorruptValueError),
                }),
                expect.objectContaining({
                    operation: 'delete',
                    kind: 'error',
                    error: deleteError,
                }),
            ]),
        );
    });

    it('reloads past a corrupt L2 entry without blocking on a slow delete, which later reports a timeout', async () => {
        vi.useFakeTimers();
        const { owner, onTierError } = redisBackedOwner({
            get: vi.fn().mockResolvedValue('{bad'),
            delete: vi.fn(never),
        });

        await expect(owner.get('d')).resolves.toEqual({ id: 'fresh' });

        await vi.advanceTimersByTimeAsync(100);
        expect(onTierError).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'delete', kind: 'timeout' }),
        );
    });

    it('invalidate empties L1 and rejects if the L2 delete fails', async () => {
        const { owner, load, onTierError } = redisBackedOwner({
            delete: vi.fn().mockRejectedValue(new Error('down')),
        });
        await owner.get('d');

        await expect(owner.invalidate('d')).rejects.toThrow('down');
        await owner.get('d');
        expect(load).toHaveBeenCalledTimes(2);
        expect(onTierError).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'delete', kind: 'error' }),
        );
    });

    it('invalidate times out rather than hanging on a stuck L2 delete', async () => {
        vi.useFakeTimers();
        const { owner, load } = redisBackedOwner({ delete: vi.fn(never) });
        await owner.get('d');

        const pending = expect(owner.invalidate('d')).rejects.toBeInstanceOf(
            CacheTierTimeoutError,
        );
        await vi.advanceTimersByTimeAsync(100);
        await pending;

        await owner.get('d');
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('invalidate empties L1 even if the shared delete hangs', async () => {
        const shared = new InMemoryCacheTier();
        shared.setDefaultPolicy({ ttlMs: 60 * 60_000 });
        const owner = createCacheOwner({ sharedTier: shared });
        const load = vi
            .fn()
            .mockResolvedValueOnce({ v: 1 })
            .mockResolvedValueOnce({ v: 2 });
        owner.register({ name: 'd', loader: { load } });
        await owner.get('d');

        vi.spyOn(shared, 'delete').mockImplementation(never);
        vi.spyOn(shared, 'get').mockResolvedValue({ hit: false });
        void owner.invalidate('d');

        await expect(owner.get('d')).resolves.toEqual({ v: 2 });
    });

    it('invalidate leaves L1 free of the old value when a get overlaps the L2 delete', async () => {
        let finishDelete!: () => void;
        const { owner, shared } = redisBackedOwner({
            get: vi.fn().mockResolvedValue(JSON.stringify({ id: 'old' })),
            delete: vi.fn(
                () => new Promise<void>((resolve) => (finishDelete = resolve)),
            ),
        });
        await expect(owner.get('d')).resolves.toEqual({ id: 'old' });

        const invalidating = owner.invalidate('d');
        await owner.get('d');
        vi.mocked(shared.get).mockResolvedValue(null);
        finishDelete();
        await invalidating;

        await expect(owner.get('d')).resolves.toEqual({ id: 'fresh' });
    });

    it('invalidate empties L1 after a failed L2 delete, even if a get refilled it in between', async () => {
        let failDelete!: (error: Error) => void;
        const { owner, shared } = redisBackedOwner({
            get: vi.fn().mockResolvedValue(JSON.stringify({ id: 'old' })),
            delete: vi.fn(
                () => new Promise<void>((_, reject) => (failDelete = reject)),
            ),
        });

        const invalidating = owner.invalidate('d');
        await owner.get('d');
        failDelete(new Error('down'));
        await expect(invalidating).rejects.toThrow('down');

        const readsBefore = vi.mocked(shared.get).mock.calls.length;
        await owner.get('d');
        expect(shared.get).toHaveBeenCalledTimes(readsBefore + 1);
    });

    it('propagates a loader failure to the caller', async () => {
        const { owner, load } = redisBackedOwner({
            get: vi.fn().mockRejectedValue(new Error('down')),
        });
        load.mockRejectedValueOnce(new Error('db down'));

        await expect(owner.get('d')).rejects.toThrow('db down');
    });

    it('is unaffected by an onTierError callback that throws', async () => {
        const { owner, onTierError } = redisBackedOwner({
            get: vi.fn().mockRejectedValue(new Error('down')),
        });
        onTierError.mockImplementation(() => {
            throw new Error('logger broke');
        });

        await expect(owner.get('d')).resolves.toEqual({ id: 'fresh' });
    });

    it('is unaffected by an async onTierError callback that rejects', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
            // Deliberately not vi.fn(): a mock would catch its own rejection and hide the case under test.
            const owner = createCacheOwner({
                sharedTier: new RedisCacheTier(
                    {
                        get: vi.fn().mockRejectedValue(new Error('down')),
                        set: vi.fn().mockResolvedValue(undefined),
                        delete: vi.fn(),
                    },
                    { operationTimeoutMs: 100 },
                ),
                // eslint-disable-next-line @typescript-eslint/no-misused-promises -- a rejecting async callback is the case under test
                onTierError: async () => {
                    throw new Error('metrics down');
                },
            });
            owner.register({
                name: 'd',
                loader: { load: async () => 'fresh' },
            });

            await expect(owner.get('d')).resolves.toBe('fresh');
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });
});
