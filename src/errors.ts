import type { CacheTierOperation } from './contracts/common.js';

/** `context` names the component that raised the error, e.g. `'CacheOwner'`; it only affects the message. */
export class CacheDomainAlreadyRegisteredError extends Error {
    constructor(
        readonly domainName: string,
        context = 'Cache',
    ) {
        super(`${context} domain "${domainName}" is already registered`);
        this.name = 'CacheDomainAlreadyRegisteredError';
    }
}

/** `context` names the component that raised the error, e.g. `'CacheOwner'`; it only affects the message. */
export class CacheDomainNotRegisteredError extends Error {
    constructor(
        readonly domainName: string,
        context = 'Cache',
    ) {
        super(`${context} domain "${domainName}" is not registered`);
        this.name = 'CacheDomainNotRegisteredError';
    }
}

export class CacheTierTimeoutError extends Error {
    constructor(
        readonly domainName: string,
        readonly operation: CacheTierOperation,
        readonly timeoutMs: number,
    ) {
        super(
            `Cache tier ${operation} for domain "${domainName}" timed out after ${timeoutMs}ms`,
        );
        this.name = 'CacheTierTimeoutError';
    }
}

export class CacheTierSerializationError extends Error {
    constructor(
        readonly domainName: string,
        message: string,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'CacheTierSerializationError';
    }
}

export class CacheTierCorruptValueError extends Error {
    constructor(
        readonly domainName: string,
        message: string,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'CacheTierCorruptValueError';
    }
}
