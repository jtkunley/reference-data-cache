const KEY_PREFIX = 'reference-data-cache:v1:';

export function redisKey(domainName: string): string {
  return KEY_PREFIX + domainName;
}
