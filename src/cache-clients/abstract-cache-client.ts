import type {
    CacheDomain,
    CacheOptions,
    CachePolicy,
} from '../contracts/common.js';
import { InMemoryCacheTier } from '../cache-tiers/in-memory-cache-tier.js';

/** Common base for the cache clients: holds registered domains and wires up the in-memory tier. */
export abstract class AbstractCacheClient {
    protected readonly domains = new Map<string, CacheDomain<unknown>>();
    protected readonly inMemoryTier: InMemoryCacheTier;

    private readonly inFlightLoads = new Map<string, Promise<unknown>>();

    protected constructor(
        private readonly clientLabel: string,
        cacheOptions?: CacheOptions,
    ) {
        this.inMemoryTier = new InMemoryCacheTier();
        if (cacheOptions?.inMemoryPolicy) {
            this.inMemoryTier.setDefaultPolicy(cacheOptions.inMemoryPolicy);
        }
    }

    protected assertDomainNameUnused(domainName: string): void {
        if (this.domains.has(domainName)) {
            throw new Error(
                `${this.clientLabel} domain "${domainName}" is already registered`,
            );
        }
    }

    protected resolveInMemoryPolicy(domain: CacheDomain<unknown>): CachePolicy {
        return domain.inMemoryPolicy ?? this.inMemoryTier.defaultPolicy;
    }

    protected registerInMemory(domainName: string, policy: CachePolicy): void {
        this.inMemoryTier.register(domainName, policy);
    }

    protected assertDomainRegistered(domainName: string): void {
        if (!this.domains.has(domainName)) {
            throw new Error(
                `${this.clientLabel} domain "${domainName}" is not registered`,
            );
        }
    }

    protected getRegisteredDomain<T>(domainName: string): CacheDomain<T> {
        this.assertDomainRegistered(domainName);
        // The check and the lookup are both synchronous, so nothing can unregister the domain in between.
        return this.domains.get(domainName) as CacheDomain<T>;
    }

    /**
     * Once the tiers have missed, lets concurrent callers for one domain share a single in-progress load.
     */
    protected async runSingleFlight<T>(
        domainName: string,
        work: () => Promise<T>,
    ): Promise<T> {
        const existing = this.inFlightLoads.get(domainName) as
            Promise<T> | undefined;
        if (existing) {
            return existing;
        }

        const promise = work();
        this.inFlightLoads.set(domainName, promise);

        try {
            return await promise;
        } finally {
            // A newer load may have replaced this one after forgetInFlightLoad; leave it in place.
            if (this.inFlightLoads.get(domainName) === promise) {
                this.inFlightLoads.delete(domainName);
            }
        }
    }

    /** Makes the next miss start a fresh load instead of joining the one already running. */
    protected forgetInFlightLoad(domainName: string): void {
        this.inFlightLoads.delete(domainName);
    }

    /**
     * Rejects loader results of `null` or `undefined`; a loader has to produce real data.
     */
    protected assertLoaderYieldedValue<T>(
        domainName: string,
        value: T,
    ): asserts value is NonNullable<T> {
        if (value === undefined || value === null) {
            throw new Error(
                `${this.clientLabel}: loader for domain "${domainName}" resolved to ${value === undefined ? 'undefined' : 'null'}, which is not allowed`,
            );
        }
    }
}
