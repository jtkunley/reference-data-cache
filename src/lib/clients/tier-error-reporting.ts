import type { CacheTierOperation } from '../tiers/types.js';
import type { CacheTierErrorEvent, CacheTierErrorKind } from './types.js';

export type TierErrorHook = (event: CacheTierErrorEvent) => unknown;

function noop(): void {
  // Intentionally empty.
}

export function classifyTierError(error: unknown): CacheTierErrorKind {
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

/** Calls the hook with a shared-tier failure, containing anything the hook throws or rejects. */
export function reportTierError(
  hook: TierErrorHook | undefined,
  domain: string,
  operation: CacheTierOperation,
  error: unknown,
): void {
  if (hook === undefined) return;
  const event: CacheTierErrorEvent = Object.freeze({
    domain,
    tier: 'shared',
    operation,
    kind: classifyTierError(error),
    error,
  });
  try {
    Promise.resolve(hook(event)).catch(noop);
  } catch {
    // A failing hook must not change cache results.
  }
}
