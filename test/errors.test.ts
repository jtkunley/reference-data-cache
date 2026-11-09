import { describe, expect, it } from 'vitest';
import {
  CacheDomainAlreadyRegisteredError,
  CacheDomainNotRegisteredError,
  CacheTierCorruptValueError,
  CacheTierSerializationError,
  CacheTierTimeoutError,
} from '../src/index.js';

describe('errors', () => {
  it.each([
    ['CacheDomainAlreadyRegisteredError', new CacheDomainAlreadyRegisteredError('d')],
    ['CacheDomainNotRegisteredError', new CacheDomainNotRegisteredError('d')],
    ['CacheTierTimeoutError', new CacheTierTimeoutError('d', 'get', 500)],
    ['CacheTierSerializationError', new CacheTierSerializationError('d')],
    ['CacheTierCorruptValueError', new CacheTierCorruptValueError('d')],
  ])('%s has a matching name and exposes domainName', (name, error) => {
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.domainName).toBe('d');
  });

  it('defaults registration messages to Cache and accepts a source', () => {
    expect(new CacheDomainNotRegisteredError('d').message).toMatch(/^Cache: .*"d"/);
    expect(new CacheDomainNotRegisteredError('d', 'CacheReader').message).toMatch(/^CacheReader:/);
  });

  it('preserves causes', () => {
    const cause = new SyntaxError('bad');
    expect(new CacheTierCorruptValueError('d', { cause }).cause).toBe(cause);
    expect(new CacheTierSerializationError('d', { cause }).cause).toBe(cause);
  });
});
