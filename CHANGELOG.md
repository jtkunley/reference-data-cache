# Changelog

## Unreleased

### Fixed

- `CacheOwner.invalidate` no longer lets a load or L2 read that was already in progress write its stale result back into L1 or L2, and gets issued after `invalidate` no longer join the old load.
- `CacheOwner.register` no longer leaves a half-registered domain behind when the shared tier rejects it; the call can now be retried.
- TTLs are validated at registration and in `setDefaultPolicy`. `NaN`, infinite, and negative values are rejected (previously a `NaN` TTL never expired), and `RedisCacheTier` additionally requires a positive integer, as Redis `PX` does.
- Tiers keep a frozen copy of every policy they accept, and `CacheTier.defaultPolicy` is now read-only, so mutating a policy object after the fact can no longer bypass TTL validation.
- `RedisCacheTier.set` rejects values that `JSON.stringify` turns into `undefined` (functions, symbols, `undefined`) with `CacheTierSerializationError`, instead of sending `undefined` to the client.

### Changed

- The package is now named `@jtkunley/reference-data-cache` and licensed under MIT.
- Redis keys use the prefix `reference-data-cache` (previously `cache-manager`), so entries written by 1.0.0 are not read and expire on their own.
- `CacheOwner.get` runs the L2 read inside the single flight, so concurrent L1 misses for a domain share one shared-tier read instead of issuing one each.
- An L1 TTL longer than the L2 TTL and an invalid `operationTimeoutMs` now throw `RangeError` (previously plain `Error`), matching other TTL validation.
- Clients throw `CacheDomainAlreadyRegisteredError` and `CacheDomainNotRegisteredError` (previously plain `Error`), matching the tiers. Both errors expose `domainName`; messages are unchanged.

### Added

- `unregister(domainName)` on the built-in tiers.
- Exports for `CacheDomainAlreadyRegisteredError`, `CacheDomainNotRegisteredError`, and the `SharedCacheClient` and `RedisV3Client` types.

## 1.0.0

Initial standalone release.

- `CacheReader` (in-memory) and `CacheOwner` (in-memory L1 + shared L2) clients with named domains and loaders.
- `InMemoryCacheTier` and `RedisCacheTier` backends, including a `redis` v3 adapter.
- Shared-tier resilience: bounded operation timeouts, corrupt-value recovery, best-effort writes, and an `onTierError` hook.
