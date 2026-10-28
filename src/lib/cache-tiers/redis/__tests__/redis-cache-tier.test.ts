import {
    CACHE_KEY_PREFIX,
    CACHE_KEY_VERSION,
    type SharedCacheClient,
} from '../../../contracts/common.js';
import {
    CacheDomainAlreadyRegisteredError,
    CacheDomainNotRegisteredError,
    CacheTierCorruptValueError,
    CacheTierSerializationError,
    CacheTierTimeoutError,
} from '../../cache-tier-errors.js';
import {
    DEFAULT_REDIS_OPERATION_TIMEOUT_MS,
    RedisCacheTier,
} from '../redis-cache-tier.js';

const never = () => new Promise<never>(() => undefined);

function expectedKey(domainName: string) {
    return `${CACHE_KEY_PREFIX}:${CACHE_KEY_VERSION}:${domainName}`;
}

describe('RedisCacheTier', () => {
    it('stores values as JSON and parses them back on read', async () => {
        const client: SharedCacheClient = {
            get: vi.fn().mockResolvedValue(JSON.stringify({ id: 9 })),
            set: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined),
        };

        const tier = new RedisCacheTier(client);
        tier.register('d', { ttlMs: 100 });

        await expect(tier.get<{ id: number }>('d')).resolves.toEqual({
            hit: true,
            value: { id: 9 },
        });
    });

    it('reports a miss when the client finds no key', async () => {
        const client: SharedCacheClient = {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn(),
            delete: vi.fn(),
        };

        const tier = new RedisCacheTier(client);
        tier.register('d', { ttlMs: 1 });

        await expect(tier.get('d')).resolves.toEqual({ hit: false });
    });

    it('treats a stored JSON null as a hit whose value is null', async () => {
        const client: SharedCacheClient = {
            get: vi.fn().mockResolvedValue('null'),
            set: vi.fn(),
            delete: vi.fn(),
        };

        const tier = new RedisCacheTier(client);
        tier.register('nullable', { ttlMs: 100 });

        await expect(tier.get<null>('nullable')).resolves.toEqual({
            hit: true,
            value: null,
        });
    });

    it('uses the versioned, prefixed key for every operation', async () => {
        const client: SharedCacheClient = {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined),
        };

        const tier = new RedisCacheTier(client);
        tier.register('myDomain', { ttlMs: 5000 });

        await tier.get('myDomain');
        await tier.set('myDomain', { a: 1 });
        await tier.delete('myDomain');

        expect(client.get).toHaveBeenCalledWith(expectedKey('myDomain'));
        expect(client.set).toHaveBeenCalledWith(
            expectedKey('myDomain'),
            '{"a":1}',
            5000,
        );
        expect(client.delete).toHaveBeenCalledWith(expectedKey('myDomain'));
    });

    it('fails to read a stored value that is not JSON', async () => {
        const client: SharedCacheClient = {
            get: vi.fn().mockResolvedValue('{ not json'),
            set: vi.fn(),
            delete: vi.fn(),
        };

        const tier = new RedisCacheTier(client);
        tier.register('badJson', { ttlMs: 100 });

        await expect(tier.get('badJson')).rejects.toThrow(
            /RedisCacheTier: JSON\.parse failed for domain "badJson"/,
        );
    });

    it('raises CacheTierCorruptValueError for an unparseable stored value', async () => {
        const client: SharedCacheClient = {
            get: vi.fn().mockResolvedValue('{'),
            set: vi.fn(),
            delete: vi.fn(),
        };

        const tier = new RedisCacheTier(client);
        tier.register('badJson', { ttlMs: 100 });

        await expect(tier.get('badJson')).rejects.toMatchObject({
            name: 'CacheTierCorruptValueError',
            domainName: 'badJson',
        });
        await expect(tier.get('badJson')).rejects.toBeInstanceOf(
            CacheTierCorruptValueError,
        );
    });

    it('keeps the SyntaxError from JSON.parse as the error cause', async () => {
        const client: SharedCacheClient = {
            get: vi.fn().mockResolvedValue('{'),
            set: vi.fn(),
            delete: vi.fn(),
        };

        const tier = new RedisCacheTier(client);
        tier.register('badJson', { ttlMs: 100 });

        await expect(tier.get('badJson')).rejects.toMatchObject({
            cause: expect.any(SyntaxError),
        });
    });

    it('fails to write a value that JSON cannot represent', async () => {
        const client: SharedCacheClient = {
            get: vi.fn(),
            set: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn(),
        };

        const tier = new RedisCacheTier(client);
        tier.register('circ', { ttlMs: 100 });

        const circular: Record<string, unknown> = {};
        circular['self'] = circular;

        await expect(tier.set('circ', circular)).rejects.toThrow(
            /RedisCacheTier: JSON\.stringify failed for domain "circ"/,
        );
        await expect(tier.set('circ', circular)).rejects.toBeInstanceOf(
            CacheTierSerializationError,
        );
        expect(client.set).not.toHaveBeenCalled();
    });

    it('keeps the TypeError from JSON.stringify as the error cause, e.g. for a BigInt', async () => {
        const client: SharedCacheClient = {
            get: vi.fn(),
            set: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn(),
        };

        const tier = new RedisCacheTier(client);
        tier.register('big', { ttlMs: 100 });

        await expect(tier.set('big', 1n)).rejects.toMatchObject({
            cause: expect.any(TypeError),
        });
    });

    it('refuses a second registration of the same domain', () => {
        const client: SharedCacheClient = {
            get: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
        };

        const tier = new RedisCacheTier(client);
        tier.register('d', { ttlMs: 1 });

        expect(() => tier.register('d', { ttlMs: 2 })).toThrow(
            CacheDomainAlreadyRegisteredError,
        );
    });

    it('rejects every operation on a domain that is not registered', async () => {
        const client: SharedCacheClient = {
            get: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
        };

        const tier = new RedisCacheTier(client);

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

    it('takes its defaultPolicy from the constructor options', () => {
        const client: SharedCacheClient = {
            get: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
        };

        const ttlMs = 42;
        const tier = new RedisCacheTier(client, {
            defaultPolicy: { ttlMs },
        });

        expect(tier.defaultPolicy).toEqual({ ttlMs });
    });

    it('has a static NAME identifier', () => {
        expect(RedisCacheTier.NAME).toBe('redis');
    });

    describe('per-call timeouts', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31])(
            'refuses an operationTimeoutMs of %s',
            (operationTimeoutMs) => {
                const client: SharedCacheClient = {
                    get: vi.fn(),
                    set: vi.fn(),
                    delete: vi.fn(),
                };

                expect(
                    () => new RedisCacheTier(client, { operationTimeoutMs }),
                ).toThrow(/operationTimeoutMs must be a positive number/);
            },
        );

        it('falls back to DEFAULT_REDIS_OPERATION_TIMEOUT_MS when no timeout is configured', async () => {
            vi.useFakeTimers();
            const client: SharedCacheClient = {
                get: vi.fn(never),
                set: vi.fn(),
                delete: vi.fn(),
            };
            const tier = new RedisCacheTier(client);
            tier.register('d', { ttlMs: 100 });

            let settled = false;
            const pending = expect(
                tier.get('d').finally(() => (settled = true)),
            ).rejects.toBeInstanceOf(CacheTierTimeoutError);
            await vi.advanceTimersByTimeAsync(
                DEFAULT_REDIS_OPERATION_TIMEOUT_MS - 1,
            );
            expect(settled).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            await pending;
        });

        it('lets a prompt call through and cleans up its timer', async () => {
            vi.useFakeTimers();
            const client: SharedCacheClient = {
                get: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })),
                set: vi.fn(),
                delete: vi.fn(),
            };
            const tier = new RedisCacheTier(client, {
                operationTimeoutMs: 250,
            });
            tier.register('d', { ttlMs: 100 });

            await expect(tier.get('d')).resolves.toEqual({
                hit: true,
                value: { ok: true },
            });
            expect(vi.getTimerCount()).toBe(0);
        });

        it.each([
            ['get', (tier: RedisCacheTier) => tier.get('d')],
            ['set', (tier: RedisCacheTier) => tier.set('d', { a: 1 })],
            ['delete', (tier: RedisCacheTier) => tier.delete('d')],
        ] as const)(
            'fails %s with CacheTierTimeoutError if the client hangs',
            async (operation, run) => {
                vi.useFakeTimers();
                const client: SharedCacheClient = {
                    get: vi.fn(never),
                    set: vi.fn(never),
                    delete: vi.fn(never),
                };
                const tier = new RedisCacheTier(client, {
                    operationTimeoutMs: 250,
                });
                tier.register('d', { ttlMs: 100 });

                const pending = expect(run(tier)).rejects.toMatchObject({
                    name: 'CacheTierTimeoutError',
                    domainName: 'd',
                    operation,
                    timeoutMs: 250,
                });
                await vi.advanceTimersByTimeAsync(250);
                await pending;
            },
        );
    });
});
