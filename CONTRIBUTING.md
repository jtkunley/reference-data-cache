# Contributing

Thanks for your interest in improving reference-data-cache.

## Setup

```sh
git clone https://github.com/jtkunley/reference-data-cache.git
cd reference-data-cache
npm install
```

Use Node.js 22 or later (`.nvmrc` pins the development version).

## Project layout

`src/index.ts` is the only public entry point; everything else lives under `src/lib/`,
grouped by concern. Tests mirror the same groups under `test/`.

```text
src/
  index.ts                  public exports
  lib/
    clients/                CacheReader and CacheOwner
      reader.ts             local-only client and single-flight loading
      owner.ts              shared-tier reads, background writes, invalidation
      domain-state.ts       per-domain local entry, in-flight refresh, generation
      tier-error-reporting.ts  onTierError classification and containment
      types.ts              domain, loader, client, and event types
    tiers/                  storage tiers
      types.ts              CacheTier contract
      in-memory-tier.ts
      redis/
        redis-tier.ts       RedisCacheTier
        redis-v3.ts         callback-client adapter
        deadline.ts         per-operation timeouts
        json.ts             serialization and corrupt-value detection
        keys.ts             key naming
    policy/                 CachePolicy, defaults, and validation
    errors/                 registration and tier error classes
    util/                   small shared helpers
```

## Workflow

- `npm test` runs the test suite; `npm run test:watch` reruns on change.
- `npm run check` runs everything CI runs: typecheck, lint, format check, and tests.
- `npm run format` applies Prettier.
- `npm run build` produces `dist/`.

## Behavior changes

[`docs/behavior-spec.md`](docs/behavior-spec.md) is the contract. If a change alters
observable behavior, update the spec, add or adjust tests that pin the new behavior, and
add an entry under an `Unreleased` heading in [CHANGELOG.md](CHANGELOG.md).

## Pull requests

Keep pull requests focused, describe the motivation, and make sure `npm run check` passes.
