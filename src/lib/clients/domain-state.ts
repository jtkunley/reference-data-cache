import type { CacheLoader } from './types.js';

/** Per-client bookkeeping for one registered domain. */
export interface DomainState {
  readonly name: string;
  readonly load: CacheLoader<unknown>['load'];
  readonly localTtlMs: number;
  entry: { readonly value: unknown; readonly expiresAt: number } | undefined;
  flight: Promise<unknown> | undefined;
  /** Bumped by invalidation; refreshes from an older generation must not populate caches. */
  generation: number;
}

/** Returns the local entry if it has not expired, dropping it otherwise. */
export function readLocal(state: DomainState): DomainState['entry'] {
  const entry = state.entry;
  if (entry === undefined) return undefined;
  if (Date.now() >= entry.expiresAt) {
    state.entry = undefined;
    return undefined;
  }
  return entry;
}

/** Stores a value unless an invalidation superseded the refresh. Returns whether it stored. */
export function storeLocal(state: DomainState, generation: number, value: unknown): boolean {
  if (state.generation !== generation) return false;
  state.entry = { value, expiresAt: Date.now() + state.localTtlMs };
  return true;
}

/** Drops the local value and detaches in-flight refreshes from future reads. */
export function supersede(state: DomainState): void {
  state.generation += 1;
  state.flight = undefined;
  state.entry = undefined;
}
