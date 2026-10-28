import type { CacheTier, CacheTierLookup } from '../contracts/common.js';
import { AbstractCacheTier } from './abstract-cache-tier.js';

interface InMemoryCacheEntry {
    value: unknown;
    expiresAt: number;
}

export class InMemoryCacheTier extends AbstractCacheTier implements CacheTier {
    static readonly NAME = 'in-memory';

    private readonly entries = new Map<string, InMemoryCacheEntry>();

    constructor() {
        super({ ttlMs: 5 * 60 * 1000 }); // 5 min
    }

    override unregister(domainName: string): void {
        super.unregister(domainName);
        this.entries.delete(domainName);
    }

    async get<T>(domainName: string): Promise<CacheTierLookup<T>> {
        this.assertRegistered(domainName);

        const entry = this.entries.get(domainName);
        if (!entry) {
            return { hit: false };
        }

        const now = Date.now();
        if (now >= entry.expiresAt) {
            this.entries.delete(domainName);
            return { hit: false };
        }

        return { hit: true, value: entry.value as T };
    }

    async set<T>(domainName: string, value: T): Promise<void> {
        const policy = this.getPolicy(domainName);
        const ttlMs = policy.ttlMs;
        const expiresAt = Date.now() + ttlMs;
        this.entries.set(domainName, { value, expiresAt });
    }

    async delete(domainName: string): Promise<void> {
        this.assertRegistered(domainName);
        this.entries.delete(domainName);
    }
}
