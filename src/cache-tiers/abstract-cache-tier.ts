import type {
    CachePolicy,
    CacheTier,
    CacheTierLookup,
} from '../contracts/common.js';
import {
    CacheDomainAlreadyRegisteredError,
    CacheDomainNotRegisteredError,
} from '../errors.js';

export abstract class AbstractCacheTier implements CacheTier {
    private currentDefaultPolicy: Readonly<CachePolicy>;
    private readonly policies = new Map<string, Readonly<CachePolicy>>();

    /** Subclasses pass a built-in default here; it is trusted, unlike values passed to `setDefaultPolicy`. */
    protected constructor(defaultPolicy: CachePolicy) {
        this.currentDefaultPolicy = snapshot(defaultPolicy);
    }

    get defaultPolicy(): Readonly<CachePolicy> {
        return this.currentDefaultPolicy;
    }

    setDefaultPolicy(policy: CachePolicy): void {
        const copy = snapshot(policy);
        this.assertValidPolicy(copy, 'the default policy');
        this.currentDefaultPolicy = copy;
    }

    register(domainName: string, policy: CachePolicy): void {
        if (this.policies.has(domainName)) {
            throw new CacheDomainAlreadyRegisteredError(domainName);
        }
        const copy = snapshot(policy);
        this.assertValidPolicy(copy, `domain "${domainName}"`);

        this.policies.set(domainName, copy);
    }

    /** Forgets a domain so its name can be registered again; unknown names are ignored. */
    unregister(domainName: string): void {
        this.policies.delete(domainName);
    }

    abstract get<T>(domainName: string): Promise<CacheTierLookup<T>>;
    abstract set<T>(domainName: string, value: T): Promise<void>;
    abstract delete(domainName: string): Promise<void>;

    protected getPolicy(domainName: string): Readonly<CachePolicy> {
        this.assertRegistered(domainName);
        return this.policies.get(domainName)!;
    }

    /** Tiers whose backing store is stricter about TTLs override this. */
    protected assertValidPolicy(policy: CachePolicy, subject: string): void {
        const { ttlMs } = policy;
        if (!(Number.isFinite(ttlMs) && ttlMs >= 0)) {
            throw new RangeError(
                `Invalid TTL for ${subject}: ttlMs must be a finite number >= 0, got ${ttlMs}`,
            );
        }
    }

    protected assertRegistered(domainName: string): void {
        if (!this.policies.has(domainName)) {
            throw new CacheDomainNotRegisteredError(domainName);
        }
    }
}

/** Validated policies are copied and frozen so a caller mutating its own object later cannot bypass validation. */
function snapshot(policy: CachePolicy): Readonly<CachePolicy> {
    return Object.freeze({ ttlMs: policy.ttlMs });
}
