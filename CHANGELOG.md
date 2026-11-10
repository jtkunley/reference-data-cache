# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-11-09

First public release. Version 1.0.0 was published from an earlier codebase and then
withdrawn; npm does not allow a version number to be reused.

### Added

- `createCacheReader` for local-only caching and `createCacheOwner` for local plus shared
  caching with `invalidate`.
- `InMemoryCacheTier` and `RedisCacheTier`, plus `createRedisCacheTierFromRedisV3` for
  callback-style Redis v3 clients.
- Per-client single-flight loading, per-domain and client-level TTL policies, and
  `onTierError` reporting for shared-tier failures.
- Typed errors: `CacheDomainAlreadyRegisteredError`, `CacheDomainNotRegisteredError`,
  `CacheTierTimeoutError`, `CacheTierSerializationError`, and `CacheTierCorruptValueError`.

[1.0.1]: https://github.com/jtkunley/reference-data-cache/releases/tag/v1.0.1
