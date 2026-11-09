import {
  CacheTierCorruptValueError,
  CacheTierSerializationError,
} from '../../errors/tier-errors.js';

export function serialize(domainName: string, value: unknown): string {
  let payload: unknown;
  try {
    payload = JSON.stringify(value);
  } catch (error) {
    throw new CacheTierSerializationError(
      domainName,
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  if (typeof payload !== 'string') throw new CacheTierSerializationError(domainName);
  return payload;
}

export function deserialize(domainName: string, raw: unknown): unknown {
  if (typeof raw !== 'string') {
    throw new CacheTierCorruptValueError(domainName, {
      cause: new TypeError(`expected a string from Redis, got ${typeof raw}`),
    });
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new CacheTierCorruptValueError(domainName, { cause: error });
  }
}
