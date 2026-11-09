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
