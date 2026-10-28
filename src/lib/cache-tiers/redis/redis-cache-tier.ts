import {
    CACHE_KEY_PREFIX,
    CACHE_KEY_VERSION,
    type CachePolicy,
    type CacheTier,
    type CacheTierLookup,
    type CacheTierOperation,
    type SharedCacheClient,
} from '../../contracts/common.js';
import { AbstractCacheTier } from '../abstract-cache-tier.js';
import {
    CacheTierCorruptValueError,
    CacheTierSerializationError,
    CacheTierTimeoutError,
} from '../cache-tier-errors.js';

export const DEFAULT_REDIS_OPERATION_TIMEOUT_MS = 500;

// Largest delay setTimeout honours; anything above it overflows and fires almost immediately.
const MAX_OPERATION_TIMEOUT_MS = 2 ** 31 - 1;

export interface RedisCacheTierOptions {
    defaultPolicy?: CachePolicy;
    /** How long a single Redis call may take before failing with {@link CacheTierTimeoutError}. Falls back to {@link DEFAULT_REDIS_OPERATION_TIMEOUT_MS}. */
    operationTimeoutMs?: number;
}

export class RedisCacheTier extends AbstractCacheTier implements CacheTier {
    static readonly NAME = 'redis';

    defaultPolicy: CachePolicy = { ttlMs: 12 * 60 * 60 * 1000 }; // 12 h

    private readonly client: SharedCacheClient;
    private readonly operationTimeoutMs: number;

    constructor(client: SharedCacheClient, options?: RedisCacheTierOptions) {
        super();
        this.client = client;
        if (options?.defaultPolicy !== undefined) {
            this.defaultPolicy = options.defaultPolicy;
        }

        const operationTimeoutMs =
            options?.operationTimeoutMs ?? DEFAULT_REDIS_OPERATION_TIMEOUT_MS;
        if (!(
            operationTimeoutMs > 0 &&
            operationTimeoutMs <= MAX_OPERATION_TIMEOUT_MS
        )) {
            throw new Error(
                `RedisCacheTier: operationTimeoutMs must be a positive number no greater than ${MAX_OPERATION_TIMEOUT_MS}, got ${operationTimeoutMs}`,
            );
        }
        this.operationTimeoutMs = operationTimeoutMs;
    }

    async get<T>(domainName: string): Promise<CacheTierLookup<T>> {
        this.assertRegistered(domainName);

        const key = this.buildKey(domainName);
        const value = await this.withTimeout(domainName, 'get', () =>
            this.client.get(key),
        );
        if (value === null) {
            return { hit: false };
        }

        try {
            return { hit: true, value: JSON.parse(value) as T };
        } catch (cause) {
            throw new CacheTierCorruptValueError(
                domainName,
                `RedisCacheTier: JSON.parse failed for domain "${domainName}" (stored value is not valid JSON)`,
                cause instanceof Error ? { cause } : undefined,
            );
        }
    }

    async set<T>(domainName: string, value: T): Promise<void> {
        const policy = this.getPolicy(domainName);
        const key = this.buildKey(domainName);
        let payload: string;
        try {
            payload = JSON.stringify(value);
        } catch (cause) {
            throw new CacheTierSerializationError(
                domainName,
                `RedisCacheTier: JSON.stringify failed for domain "${domainName}" (value is not JSON-serializable)`,
                cause instanceof Error ? { cause } : undefined,
            );
        }
        await this.withTimeout(domainName, 'set', () =>
            this.client.set(key, payload, policy.ttlMs),
        );
    }

    async delete(domainName: string): Promise<void> {
        this.assertRegistered(domainName);
        const key = this.buildKey(domainName);
        await this.withTimeout(domainName, 'delete', () =>
            this.client.delete(key),
        );
    }

    private buildKey(domainName: string): string {
        return `${CACHE_KEY_PREFIX}:${CACHE_KEY_VERSION}:${domainName}`;
    }

    /** Replies that arrive after the deadline are discarded; because the call sits inside `Promise.race`, a late rejection never goes unhandled. */
    private async withTimeout<R>(
        domainName: string,
        operation: CacheTierOperation,
        call: () => Promise<R>,
    ): Promise<R> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
                () =>
                    reject(
                        new CacheTierTimeoutError(
                            domainName,
                            operation,
                            this.operationTimeoutMs,
                        ),
                    ),
                this.operationTimeoutMs,
            );
        });

        try {
            return await Promise.race([call(), timeout]);
        } finally {
            clearTimeout(timer);
        }
    }
}
