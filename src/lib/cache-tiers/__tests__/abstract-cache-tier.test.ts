import type { CacheTierLookup } from '../../contracts/common.js';
import { AbstractCacheTier } from '../abstract-cache-tier.js';
import {
    CacheDomainAlreadyRegisteredError,
    CacheDomainNotRegisteredError,
} from '../cache-tier-errors.js';

/** Bare-bones tier used only to test the registration checks in `AbstractCacheTier`. */
class StubCacheTier extends AbstractCacheTier {
    defaultPolicy = { ttlMs: 1000 };

    async get<T>(domainName: string): Promise<CacheTierLookup<T>> {
        this.assertRegistered(domainName);
        return { hit: false };
    }

    async set<T>(_domainName: string, _value: T): Promise<void> {
        return;
    }

    async delete(_domainName: string): Promise<void> {
        return;
    }
}

describe('AbstractCacheTier', () => {
    it('refuses to register a domain name that is already taken', () => {
        const tier = new StubCacheTier();
        tier.register('d', { ttlMs: 1 });

        expect(() => tier.register('d', { ttlMs: 2 })).toThrow(
            CacheDomainAlreadyRegisteredError,
        );
    });

    it('rejects get for a domain that was never registered', async () => {
        const tier = new StubCacheTier();

        await expect(tier.get('missing')).rejects.toThrow(
            CacheDomainNotRegisteredError,
        );

        tier.register('ok', { ttlMs: 1 });
        await expect(tier.get('ok')).resolves.toEqual({ hit: false });
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
        'refuses a TTL of %s for a domain or as the default',
        (ttlMs) => {
            const tier = new StubCacheTier();

            expect(() => tier.register('d', { ttlMs })).toThrow(RangeError);
            expect(() => tier.setDefaultPolicy({ ttlMs })).toThrow(
                /ttlMs must be a finite number >= 0/,
            );
            expect(tier.defaultPolicy).toEqual({ ttlMs: 1000 });
            expect(() => tier.register('d', { ttlMs: 0 })).not.toThrow();
        },
    );

    it('replaces the default policy via setDefaultPolicy', () => {
        const tier = new StubCacheTier();
        tier.setDefaultPolicy({ ttlMs: 42 });
        expect(tier.defaultPolicy).toEqual({ ttlMs: 42 });
    });
});
