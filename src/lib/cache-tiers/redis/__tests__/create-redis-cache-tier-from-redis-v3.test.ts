import {
    CACHE_KEY_PREFIX,
    CACHE_KEY_VERSION,
} from '../../../contracts/common.js';
import { createRedisCacheTierFromRedisV3 } from '../create-redis-cache-tier-from-redis-v3.js';

function expectedKey(domainName: string) {
    return `${CACHE_KEY_PREFIX}:${CACHE_KEY_VERSION}:${domainName}`;
}

describe('createRedisCacheTierFromRedisV3', () => {
    it('adapts the callback-based v3 client into a fully working tier', async () => {
        const get = vi.fn(
            (
                key: string,
                cb: (err: Error | null, r: string | null) => void,
            ) => {
                expect(key).toBe(expectedKey('d'));
                cb(null, JSON.stringify({ ok: true }));
            },
        );

        const set = vi.fn(
            (
                key: string,
                value: string,
                mode: 'PX',
                ttlMs: number,
                cb: (err: Error | null) => void,
            ) => {
                expect(key).toBe(expectedKey('d'));
                expect(value).toBe('{"ok":false}');
                expect(mode).toBe('PX');
                expect(ttlMs).toBe(250);
                cb(null);
            },
        );

        const del = vi.fn((key: string, cb: (err: Error | null) => void) => {
            expect(key).toBe(expectedKey('d'));
            cb(null);
        });

        const tier = createRedisCacheTierFromRedisV3({ get, set, del });
        tier.register('d', { ttlMs: 250 });

        await expect(tier.get<{ ok: boolean }>('d')).resolves.toEqual({
            hit: true,
            value: { ok: true },
        });

        await tier.set('d', { ok: false });
        await tier.delete('d');

        expect(get).toHaveBeenCalledTimes(1);
        expect(set).toHaveBeenCalledTimes(1);
        expect(del).toHaveBeenCalledTimes(1);
    });

    it('passes defaultPolicy through to the created tier', () => {
        const tier = createRedisCacheTierFromRedisV3(
            {
                get: vi.fn(),
                set: vi.fn(),
                del: vi.fn(),
            },
            { defaultPolicy: { ttlMs: 99 } },
        );

        expect(tier.defaultPolicy).toEqual({ ttlMs: 99 });
    });

    it('propagates an error from the del callback', async () => {
        const boom = new Error('delete failed');
        const del = vi.fn((_key: string, cb: (err: Error | null) => void) => {
            cb(boom);
        });

        const tier = createRedisCacheTierFromRedisV3({
            get: vi.fn((_k, cb) => cb(null, null)),
            set: vi.fn((_k, _v, _m, _t, cb) => cb(null)),
            del,
        });
        tier.register('d', { ttlMs: 1 });

        await expect(tier.delete('d')).rejects.toBe(boom);
    });

    it('propagates an error from the set callback', async () => {
        const boom = new Error('write failed');
        const set = vi.fn(
            (
                _k: string,
                _v: string,
                _m: 'PX',
                _t: number,
                cb: (err: Error | null) => void,
            ) => {
                cb(boom);
            },
        );

        const tier = createRedisCacheTierFromRedisV3({
            get: vi.fn((_k, cb) => cb(null, null)),
            set,
            del: vi.fn((_k, cb) => cb(null)),
        });
        tier.register('d', { ttlMs: 1 });

        await expect(tier.set('d', 1)).rejects.toBe(boom);
    });

    it('propagates an error from the get callback', async () => {
        const boom = new Error('redis unavailable');
        const get = vi.fn(
            (
                _key: string,
                cb: (err: Error | null, r: string | null) => void,
            ) => {
                cb(boom, null);
            },
        );

        const tier = createRedisCacheTierFromRedisV3({
            get,
            set: vi.fn((_k, _v, _m, _t, cb) => cb(null)),
            del: vi.fn((_k, cb) => cb(null)),
        });
        tier.register('d', { ttlMs: 1 });

        await expect(tier.get('d')).rejects.toBe(boom);
    });
});
