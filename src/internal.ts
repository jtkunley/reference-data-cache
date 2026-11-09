/** Calls `fn`, turning a synchronous throw into a rejected promise. */
export function attempt<T>(fn: () => PromiseLike<T> | T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (error) {
    return Promise.reject(error);
  }
}

export function assertDomainName(
  domainName: unknown,
  source: string,
): asserts domainName is string {
  if (typeof domainName !== 'string' || domainName.length === 0) {
    throw new TypeError(`${source}: domain name must be a non-empty string`);
  }
}
