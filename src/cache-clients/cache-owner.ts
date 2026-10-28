import type {
    CacheDomain,
    CachePolicy,
    CacheTier,
    CacheTierErrorKind,
    CacheTierLookup,
    CacheTierOperation,
} from '../contracts/common.js';
import type {
    CacheOwner,
    CacheOwnerOptions,
    CreateCacheOwner,
} from '../contracts/cache-owner.js';
import {
    CacheTierCorruptValueError,
    CacheTierSerializationError,
    CacheTierTimeoutError,
} from '../errors.js';
import { AbstractCacheClient } from './abstract-cache-client.js';

class CacheOwnerImpl extends AbstractCacheClient implements CacheOwner {
    private readonly sharedTier: CacheTier;
    /** Bumped by invalidate; work that began under an older generation must not write to the tiers. */
    private readonly generations = new Map<string, number>();

    constructor(private readonly options: CacheOwnerOptions) {
        super('CacheOwner', options);
        this.sharedTier = options.sharedTier;
    }

    register<T>(domain: CacheDomain<T>): void {
        this.assertDomainNameUnused(domain.name);

        const inMemoryPolicy = this.resolveInMemoryPolicy(domain);

        const sharedPolicy: CachePolicy =
            domain.sharedPolicy ?? this.sharedTier.defaultPolicy;

        if (inMemoryPolicy.ttlMs > sharedPolicy.ttlMs) {
            throw new Error(
                `CacheOwner domain "${domain.name}" has invalid policy configuration: in-memory TTL must be less than or equal to shared TTL`,
            );
        }

        this.registerInMemory(domain.name, inMemoryPolicy);
        try {
            this.sharedTier.register(domain.name, sharedPolicy);
        } catch (error) {
            // A failed register must leave nothing behind, so the caller can fix the cause and retry.
            this.inMemoryTier.unregister(domain.name);
            throw error;
        }
        this.domains.set(domain.name, domain);
    }

    async get<T>(domainName: string): Promise<T> {
        const domain = this.getRegisteredDomain<T>(domainName);

        const inMemoryValue = await this.inMemoryTier.get<T>(domainName);
        if (inMemoryValue.hit) {
            return inMemoryValue.value;
        }

        const readGeneration = this.generationOf(domainName);
        const sharedValue = await this.readShared<T>(domainName);
        if (sharedValue.hit) {
            if (this.generationOf(domainName) === readGeneration) {
                await this.inMemoryTier.set(domainName, sharedValue.value);
            }
            return sharedValue.value;
        }

        return this.runSingleFlight(domainName, async () => {
            const loadGeneration = this.generationOf(domainName);

            // Re-check L1: another get could have populated it during our L2 round trip.
            const cached = await this.inMemoryTier.get<T>(domainName);
            if (cached.hit) {
                return cached.value;
            }

            const loadedValue = await domain.loader.load();
            this.assertLoaderYieldedValue(domainName, loadedValue);
            if (this.generationOf(domainName) !== loadGeneration) {
                return loadedValue;
            }
            void this.writeShared(domainName, loadedValue);
            await this.inMemoryTier.set(domainName, loadedValue);
            return loadedValue;
        });
    }

    async invalidate(domainName: string): Promise<void> {
        this.assertDomainRegistered(domainName);
        this.generations.set(domainName, this.generationOf(domainName) + 1);
        this.forgetInFlightLoad(domainName);

        // L1 is cleared twice: up front, since the L2 delete can stall, and again afterwards, in case a concurrent get repopulated L1 from L2.
        await this.inMemoryTier.delete(domainName);
        try {
            await this.sharedTier.delete(domainName);
        } catch (error) {
            this.reportTierError(domainName, 'delete', error);
            throw error;
        } finally {
            await this.inMemoryTier.delete(domainName);
        }
    }

    private generationOf(domainName: string): number {
        return this.generations.get(domainName) ?? 0;
    }

    private async readShared<T>(
        domainName: string,
    ): Promise<CacheTierLookup<T>> {
        try {
            return await this.sharedTier.get<T>(domainName);
        } catch (error) {
            this.reportTierError(domainName, 'get', error);
            if (error instanceof CacheTierCorruptValueError) {
                // Remove the unreadable entry regardless of whether the loader succeeds.
                void this.sharedTier
                    .delete(domainName)
                    .catch((deleteError: unknown) =>
                        this.reportTierError(domainName, 'delete', deleteError),
                    );
            }
            return { hit: false };
        }
    }

    private async writeShared<T>(domainName: string, value: T): Promise<void> {
        try {
            await this.sharedTier.set(domainName, value);
        } catch (error) {
            this.reportTierError(domainName, 'set', error);
        }
    }

    private reportTierError(
        domainName: string,
        operation: CacheTierOperation,
        error: unknown,
    ): void {
        try {
            const result: unknown = this.options.onTierError?.({
                domain: domainName,
                tier: 'shared',
                operation,
                kind: classifyTierError(error),
                error,
            });
            // An async callback may reject; ignore it.
            void Promise.resolve(result).catch(() => undefined);
        } catch {
            // Errors from the callback must never surface to the caller of get/invalidate.
        }
    }
}

function classifyTierError(error: unknown): CacheTierErrorKind {
    if (error instanceof CacheTierTimeoutError) {
        return 'timeout';
    }
    if (error instanceof CacheTierSerializationError) {
        return 'serialize';
    }
    if (error instanceof CacheTierCorruptValueError) {
        return 'corrupt-value';
    }
    return 'error';
}

export const createCacheOwner: CreateCacheOwner = (
    options: CacheOwnerOptions,
): CacheOwner => {
    return new CacheOwnerImpl(options);
};
