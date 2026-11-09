# Contributing

Thanks for your interest in improving reference-data-cache.

## Setup

```sh
git clone https://github.com/jtkunley/reference-data-cache.git
cd reference-data-cache
npm install
```

Use Node.js 22 or later (`.nvmrc` pins the development version).

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
