/** Expiry policy for one cache tier. */
export interface CachePolicy {
  /** Time to live in milliseconds, measured from the latest successful write. */
  readonly ttlMs: number;
}
