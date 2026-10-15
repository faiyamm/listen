# Contributing

Fork the repository, create a `type/short-description` branch, and open a pull request. Never include secrets or environment files.

## Work on it locally

You need Node.js 22.13 or newer (`.nvmrc` pins 22, so `nvm use` picks it) and pnpm 11.

```bash
pnpm install
```

The tests use fake Last.fm and iTunes responses, so no API key is needed.

## Scripts

```bash
pnpm build        # Compile to dist
pnpm test         # Run the test suite
pnpm test:watch   # Run it on every change
pnpm typecheck    # Typecheck without emitting
pnpm lint         # Run ESLint
pnpm format       # Format the repository
pnpm format:check # Check formatting
```

## Before opening a pull request

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Keep the engine server-safe, and cover new matching or normalization behavior with tests.

## Releasing

Releases come out of GitHub Actions through npm trusted publishing, so no npm token lives anywhere. The workflow in `.github/workflows/publish.yml` runs when a GitHub release is published.

1. Bump `version` in `package.json` on a branch and merge it.
2. Create a GitHub release whose tag is `v` plus that version, for example `v0.1.1`.
3. The workflow checks that the tag matches the version, runs the checks, builds, and publishes with provenance.
