export function assertDomainName(
  domainName: unknown,
  source: string,
): asserts domainName is string {
  if (typeof domainName !== 'string' || domainName.length === 0) {
    throw new TypeError(`${source}: domain name must be a non-empty string`);
  }
}
