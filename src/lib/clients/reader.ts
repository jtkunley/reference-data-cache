import {
  CacheDomainAlreadyRegisteredError,
  CacheDomainNotRegisteredError,
} from '../errors/registration-errors.js';
import { DEFAULT_IN_MEMORY_POLICY } from '../policy/defaults.js';
import type { CachePolicy } from '../policy/types.js';
import { localPolicy } from '../policy/validate.js';
import { attempt } from '../util/attempt.js';
import { assertDomainName } from '../util/domain-name.js';
import { readLocal, storeLocal, type DomainState } from './domain-state.js';
import type { CacheDomain, CacheReader, CacheReaderOptions } from './types.js';

export type ClientName = 'CacheReader' | 'CacheOwner';

/** Local-only client. {@link OwnerClient} extends it with a shared tier. */
export class ReaderClient implements CacheReader {
  protected readonly domains = new Map<string, DomainState>();
  protected readonly clientName: ClientName;
  readonly #defaultLocalPolicy: CachePolicy;

  constructor(clientName: ClientName, options: CacheReaderOptions) {
    this.clientName = clientName;
    this.#defaultLocalPolicy =
      options.inMemoryPolicy === undefined
        ? DEFAULT_IN_MEMORY_POLICY
        : localPolicy(options.inMemoryPolicy, `${clientName}: inMemoryPolicy`);
  }

  register<T>(domain: CacheDomain<T>): void {
    const state = this.prepare(domain);
    this.domains.set(state.name, state);
  }

  get<T>(domainName: string): Promise<T> {
    const state = this.domains.get(domainName);
    if (state === undefined) {
      return Promise.reject(new CacheDomainNotRegisteredError(domainName, this.clientName));
    }
    const entry = readLocal(state);
    if (entry !== undefined) return Promise.resolve(entry.value as T);
    if (state.flight !== undefined) return state.flight as Promise<T>;

    const flight = attempt(() => this.refresh(state, state.generation));
    state.flight = flight;
    const release = (): void => {
      if (state.flight === flight) state.flight = undefined;
    };
    flight.then(release, release);
    return flight as Promise<T>;
  }

  /** Validates and copies a domain definition without registering it anywhere. */
  protected prepare(domain: CacheDomain): DomainState {
    if (typeof domain !== 'object' || (domain as unknown) === null) {
      throw new TypeError(`${this.clientName}: domain must be an object`);
    }
    const { name, loader, inMemoryPolicy } = domain;
    assertDomainName(name, this.clientName);
    if (this.domains.has(name)) {
      throw new CacheDomainAlreadyRegisteredError(name, this.clientName);
    }
    if (
      typeof loader !== 'object' ||
      (loader as unknown) === null ||
      typeof loader.load !== 'function'
    ) {
      throw new TypeError(
        `${this.clientName}: domain "${name}" must have a loader with a load() method`,
      );
    }
    const policy =
      inMemoryPolicy === undefined
        ? this.#defaultLocalPolicy
        : localPolicy(inMemoryPolicy, `${this.clientName}: domain "${name}" inMemoryPolicy`);
    return {
      name,
      load: loader.load.bind(loader),
      localTtlMs: policy.ttlMs,
      entry: undefined,
      flight: undefined,
      generation: 0,
    };
  }

  protected async refresh(state: DomainState, generation: number): Promise<unknown> {
    const value = await this.load(state);
    storeLocal(state, generation, value);
    return value;
  }

  protected async load(state: DomainState): Promise<unknown> {
    const value = await attempt(state.load);
    if (value === null || value === undefined) {
      throw new TypeError(
        `${this.clientName}: loader for domain "${state.name}" resolved to ${String(value)}; ` +
          'loaders must not resolve to null or undefined',
      );
    }
    return value;
  }
}

/** Creates a client that caches in local memory only. */
export function createCacheReader(options: CacheReaderOptions = {}): CacheReader {
  return new ReaderClient('CacheReader', options);
}
