import { vi } from 'vitest';
import type { CacheLoader, RedisCacheClient } from '../../src/index.js';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks and I/O callbacks run. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function loaderOf<T>(fn: () => T | Promise<T>) {
  const load = vi.fn(async (): Promise<T> => fn());
  return { load } satisfies CacheLoader<T>;
}

export class FakeRedis implements RedisCacheClient {
  readonly data = new Map<string, { value: string; ttlMs: number }>();

  readonly get = vi.fn(async (key: string): Promise<string | null> => {
    return this.data.get(key)?.value ?? null;
  });

  readonly set = vi.fn(async (key: string, value: string, ttlMs: number): Promise<void> => {
    this.data.set(key, { value, ttlMs });
  });

  readonly delete = vi.fn(async (key: string): Promise<void> => {
    this.data.delete(key);
  });
}
