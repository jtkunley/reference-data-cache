# Changelog

## Unreleased

### Fixed

- `CacheOwner.invalidate` no longer lets a load or L2 read that was already in progress write its stale result back into L1 or L2, and gets issued after `invalidate` no longer join the old load.
- `CacheOwner.register` no longer leaves a half-registered domain behind when the shared tier rejects it; the call can now be retried.
- TTLs are validated at registration and in `setDefaultPolicy`. `NaN`, infinite, and negative values are rejected (previously a `NaN` TTL never expired), and `RedisCacheTier` additionally requires a positive integer, as Redis `PX` does.
- `RedisCacheTier.set` rejects values that `JSON.stringify` turns into `undefined` (functions, symbols, `undefined`) with `CacheTierSerializationError`, instead of sending `undefined` to the client.

### Added

- `unregister(domainName)` on the built-in tiers.

## 1.0.0

Initial standalone release.

- `CacheReader` (in-memory) and `CacheOwner` (in-memory L1 + shared L2) clients with named domains and loaders.
- `InMemoryCacheTier` and `RedisCacheTier` backends, including a `redis` v3 adapter.
- Shared-tier resilience: bounded operation timeouts, corrupt-value recovery, best-effort writes, and an `onTierError` hook.
