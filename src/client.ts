import { CacheDomainAlreadyRegisteredError, CacheDomainNotRegisteredError } from './errors.js';
import { assertDomainName, attempt } from './internal.js';
import { DEFAULT_IN_MEMORY_TTL_MS, localPolicy } from './policy.js';
import type {
  CacheDomain,
  CacheLoader,
  CacheOwner,
  CacheOwnerOptions,
  CachePolicy,
  CacheReader,
  CacheReaderOptions,
  CacheTier,
  CacheTierErrorEvent,
  CacheTierErrorKind,
  CacheTierOperation,
  CacheTierResult,
} from './types.js';

type ClientName = 'CacheReader' | 'CacheOwner';

interface DomainState {
  readonly name: string;
  readonly load: CacheLoader<unknown>['load'];
  readonly localTtlMs: number;
  entry: { readonly value: unknown; readonly expiresAt: number } | undefined;
  flight: Promise<unknown> | undefined;
  /** Bumped by invalidation; refreshes from an older generation must not populate caches. */
  generation: number;
}

const MISS: CacheTierResult<never> = Object.freeze({ hit: false });

function noop(): void {
  // Intentionally empty.
}

class ReaderClient implements CacheReader {
  protected readonly domains = new Map<string, DomainState>();
  protected readonly clientName: ClientName;
  readonly #defaultLocalPolicy: CachePolicy;

  constructor(clientName: ClientName, options: CacheReaderOptions) {
    this.clientName = clientName;
    this.#defaultLocalPolicy =
      options.inMemoryPolicy === undefined
        ? Object.freeze({ ttlMs: DEFAULT_IN_MEMORY_TTL_MS })
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
    const entry = this.readLocal(state);
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
    this.storeLocal(state, generation, value);
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

  /** Stores a value unless an invalidation superseded the refresh. Returns whether it stored. */
  protected storeLocal(state: DomainState, generation: number, value: unknown): boolean {
    if (state.generation !== generation) return false;
    state.entry = { value, expiresAt: Date.now() + state.localTtlMs };
    return true;
  }

  protected readLocal(state: DomainState): DomainState['entry'] {
    const entry = state.entry;
    if (entry === undefined) return undefined;
    if (Date.now() >= entry.expiresAt) {
      state.entry = undefined;
      return undefined;
    }
    return entry;
  }
}

class OwnerClient extends ReaderClient implements CacheOwner {
  readonly #tier: CacheTier;
  readonly #onTierError: ((event: CacheTierErrorEvent) => unknown) | undefined;

  constructor(options: CacheOwnerOptions) {
    super('CacheOwner', options);
    this.#tier = options.sharedTier;
    this.#onTierError = options.onTierError;
  }

  override register<T>(domain: CacheDomain<T>): void {
    const state = this.prepare(domain);
    const { sharedPolicy } = domain;
    const shared = localPolicy(
      sharedPolicy ?? this.#tier.defaultPolicy,
      `CacheOwner: domain "${state.name}" sharedPolicy`,
    );
    if (state.localTtlMs > shared.ttlMs) {
      throw new RangeError(
        `CacheOwner: domain "${state.name}" in-memory TTL (${String(state.localTtlMs)}ms) ` +
          `exceeds its shared TTL (${String(shared.ttlMs)}ms)`,
      );
    }
    this.#tier.register(state.name, shared);
    this.domains.set(state.name, state);
  }

  async invalidate(domainName: string): Promise<void> {
    const state = this.domains.get(domainName);
    if (state === undefined) {
      throw new CacheDomainNotRegisteredError(domainName, this.clientName);
    }
    this.#supersede(state);
    try {
      await attempt(() => this.#tier.delete(domainName));
    } catch (error) {
      this.#report(domainName, 'delete', error);
      throw error;
    } finally {
      this.#supersede(state);
    }
  }

  protected override async refresh(state: DomainState, generation: number): Promise<unknown> {
    const shared = await this.#readShared(state.name);
    if (shared.hit) {
      this.storeLocal(state, generation, shared.value);
      return shared.value;
    }
    const refilled = this.readLocal(state);
    if (refilled !== undefined) return refilled.value;
    const value = await this.load(state);
    if (this.storeLocal(state, generation, value)) {
      this.#background(state.name, 'set', () => this.#tier.set(state.name, value));
    }
    return value;
  }

  /** Drops the local value and detaches in-flight refreshes from future reads. */
  #supersede(state: DomainState): void {
    state.generation += 1;
    state.flight = undefined;
    state.entry = undefined;
  }

  async #readShared(domainName: string): Promise<CacheTierResult<unknown>> {
    try {
      return await attempt(() => this.#tier.get(domainName));
    } catch (error) {
      this.#report(domainName, 'get', error);
      if (classify(error) === 'corrupt-value') {
        this.#background(domainName, 'delete', () => this.#tier.delete(domainName));
      }
      return MISS;
    }
  }

  #background(domainName: string, operation: CacheTierOperation, fn: () => Promise<void>): void {
    attempt(fn).catch((error: unknown) => {
      this.#report(domainName, operation, error);
    });
  }

  #report(domain: string, operation: CacheTierOperation, error: unknown): void {
    const hook = this.#onTierError;
    if (hook === undefined) return;
    const event: CacheTierErrorEvent = Object.freeze({
      domain,
      tier: 'shared',
      operation,
      kind: classify(error),
      error,
    });
    try {
      Promise.resolve(hook(event)).catch(noop);
    } catch {
      // A failing hook must not change cache results.
    }
  }
}

function classify(error: unknown): CacheTierErrorKind {
  if (!(error instanceof Error)) return 'error';
  switch (error.name) {
    case 'CacheTierTimeoutError':
      return 'timeout';
    case 'CacheTierSerializationError':
      return 'serialize';
    case 'CacheTierCorruptValueError':
      return 'corrupt-value';
    default:
      return 'error';
  }
}

/** Creates a client that caches in local memory only. */
export function createCacheReader(options: CacheReaderOptions = {}): CacheReader {
  return new ReaderClient('CacheReader', options);
}

/** Creates a client that caches locally, shares values through `sharedTier`, and can invalidate. */
export function createCacheOwner(options: CacheOwnerOptions): CacheOwner {
  if (typeof options !== 'object' || (options as unknown) === null) {
    throw new TypeError('CacheOwner: options with a sharedTier are required');
  }
  if (typeof options.sharedTier !== 'object' || (options.sharedTier as unknown) === null) {
    throw new TypeError('CacheOwner: options.sharedTier is required');
  }
  if (options.onTierError !== undefined && typeof options.onTierError !== 'function') {
    throw new TypeError('CacheOwner: options.onTierError must be a function');
  }
  return new OwnerClient(options);
}
