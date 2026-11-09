import type { CacheTierOperation } from './types.js';

/** Thrown when a domain name is registered twice on the same client or tier. */
export class CacheDomainAlreadyRegisteredError extends Error {
  override readonly name = 'CacheDomainAlreadyRegisteredError';
  readonly domainName: string;

  constructor(domainName: string, source = 'Cache') {
    super(`${source}: domain "${domainName}" is already registered`);
    this.domainName = domainName;
  }
}

/** Thrown when reading, writing, or invalidating a domain that has not been registered. */
export class CacheDomainNotRegisteredError extends Error {
  override readonly name = 'CacheDomainNotRegisteredError';
  readonly domainName: string;

  constructor(domainName: string, source = 'Cache') {
    super(`${source}: domain "${domainName}" is not registered`);
    this.domainName = domainName;
  }
}

/** Thrown when a Redis operation does not settle within its deadline. */
export class CacheTierTimeoutError extends Error {
  override readonly name = 'CacheTierTimeoutError';
  readonly domainName: string;
  readonly operation: CacheTierOperation;
  readonly timeoutMs: number;

  constructor(domainName: string, operation: CacheTierOperation, timeoutMs: number) {
    super(`Cache: ${operation} for domain "${domainName}" timed out after ${String(timeoutMs)}ms`);
    this.domainName = domainName;
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

/** Thrown when a value cannot be converted to JSON for the shared tier. */
export class CacheTierSerializationError extends Error {
  override readonly name = 'CacheTierSerializationError';
  readonly domainName: string;

  constructor(domainName: string, options?: { cause?: unknown }) {
    super(`Cache: value for domain "${domainName}" could not be serialized to JSON`, options);
    this.domainName = domainName;
  }
}

/** Thrown when a stored shared value is not valid JSON. */
export class CacheTierCorruptValueError extends Error {
  override readonly name = 'CacheTierCorruptValueError';
  readonly domainName: string;

  constructor(domainName: string, options?: { cause?: unknown }) {
    super(`Cache: stored value for domain "${domainName}" is not valid JSON`, options);
    this.domainName = domainName;
  }
}
