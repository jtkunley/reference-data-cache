import type {
    CachePolicy,
    CacheTier,
    CacheTierLookup,
} from '../contracts/common.js';
import {
    CacheDomainAlreadyRegisteredError,
    CacheDomainNotRegisteredError,
} from './cache-tier-errors.js';

export abstract class AbstractCacheTier implements CacheTier {
    abstract defaultPolicy: CachePolicy;

    private readonly policies = new Map<string, CachePolicy>();

    setDefaultPolicy(policy: CachePolicy): void {
        this.defaultPolicy = policy;
    }

    register(domainName: string, policy: CachePolicy): void {
        if (this.policies.has(domainName)) {
            throw new CacheDomainAlreadyRegisteredError(domainName);
        }

        this.policies.set(domainName, policy);
    }

    abstract get<T>(domainName: string): Promise<CacheTierLookup<T>>;
    abstract set<T>(domainName: string, value: T): Promise<void>;
    abstract delete(domainName: string): Promise<void>;

    protected getPolicy(domainName: string): CachePolicy {
        this.assertRegistered(domainName);
        return this.policies.get(domainName)!;
    }

    protected assertRegistered(domainName: string): void {
        if (!this.policies.has(domainName)) {
            throw new CacheDomainNotRegisteredError(domainName);
        }
    }
}
