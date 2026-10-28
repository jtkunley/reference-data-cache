# Changelog

## 1.0.0

Initial standalone release.

- `CacheReader` (in-memory) and `CacheOwner` (in-memory L1 + shared L2) clients with named domains and loaders.
- `InMemoryCacheTier` and `RedisCacheTier` backends, including a `redis` v3 adapter.
- Shared-tier resilience: bounded operation timeouts, corrupt-value recovery, best-effort writes, and an `onTierError` hook.
