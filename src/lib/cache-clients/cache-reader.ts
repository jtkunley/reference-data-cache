import type { CacheDomain } from '../contracts/common.js';
import type {
    CacheReader,
    CacheReaderOptions,
    CreateCacheReader,
} from '../contracts/cache-reader.js';
import { AbstractCacheClient } from './abstract-cache-client.js';

class CacheReaderImpl extends AbstractCacheClient implements CacheReader {
    constructor(options?: CacheReaderOptions) {
        super('CacheReader', options);
    }

    register<T>(domain: CacheDomain<T>): void {
        this.assertDomainNameUnused(domain.name);

        const policy = this.resolveInMemoryPolicy(domain);
        this.registerInMemory(domain.name, policy);
        this.domains.set(domain.name, domain as CacheDomain<unknown>);
    }

    async get<T>(domainName: string): Promise<T> {
        const domain = this.getRegisteredDomain<T>(domainName);

        const cached = await this.inMemoryTier.get<T>(domainName);
        if (cached.hit) {
            return cached.value;
        }

        return this.runSingleFlight(domainName, async () => {
            const value = await domain.loader.load();
            this.assertLoaderYieldedValue(domainName, value);
            await this.inMemoryTier.set(domainName, value);
            return value;
        });
    }
}

export const createCacheReader: CreateCacheReader = (
    options?: CacheReaderOptions,
): CacheReader => {
    return new CacheReaderImpl(options);
};
