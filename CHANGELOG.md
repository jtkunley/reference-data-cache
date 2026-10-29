# Changelog

## 1.0.0 (2026-10-28)

Initial release. Requires Node 24 or later.

- `CacheReader` (in-memory) and `CacheOwner` (in-memory L1 + shared L2) clients with named domains and loaders.
- `InMemoryCacheTier` and `RedisCacheTier` backends, with `unregister(domainName)`, and a `redis` v3 adapter. Redis keys use the prefix `reference-data-cache:v1:`.
- Single-flight loading: concurrent misses for a domain share one load, and on a `CacheOwner` one shared-tier read too.
- `CacheOwner.invalidate` stops loads and shared-tier reads already in progress from writing their result back, and later gets start a fresh load.
- Shared-tier resilience: bounded operation timeouts, corrupt-value recovery, best-effort writes, and an `onTierError` hook.
- Validation at registration: TTLs must be finite and non-negative, and positive integers on `RedisCacheTier`, as Redis `PX` requires. An L1 TTL longer than the L2 TTL, or an invalid `operationTimeoutMs`, throws `RangeError`. Tiers keep a frozen copy of every policy they accept.
- A failed registration leaves nothing behind, so it can be retried.
- `RedisCacheTier.set` rejects values that `JSON.stringify` can't represent with `CacheTierSerializationError`.
- Typed errors, `CacheDomainAlreadyRegisteredError` and `CacheDomainNotRegisteredError`, each exposing `domainName`, and the `SharedCacheClient` and `RedisV3Client` types for custom clients.
