# Contributing

## Prerequisites

- Node `>=24.15.0 <25` (see [`.nvmrc`](../.nvmrc))
- pnpm `>=11.1.2 <12` (pinned via `packageManager` in `package.json`)

## Setup

```sh
pnpm install
```

This installs dependencies and registers the git hooks (via lefthook).

## Workflow

- **Write tests first**, then the implementation. Tests live next to their
  source as `*.test.ts` / `*.spec.ts`.
- Run the full gate before pushing:

  ```sh
  pnpm run check   # lint, import-cycles, typecheck, build, test, format, knip
  ```

- Hooks run automatically: `pre-commit` (oxlint + prettier on staged files) and
  `pre-push` (typecheck + test).

## Project structure

Every workspace member is a package under `packages/*`. See the
[root README](../README.md) for the dependency graph and package descriptions.
