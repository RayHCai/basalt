# CLAUDE

Instructions for Claude Code (and compatible agents) when working in this repo.

This file mirrors [AGENTS.md](./AGENTS.md); keep the two in sync.

## Conventions

- **Tests first.** When adding new code, write the tests first, then the logic.
- **Tests live next to source** (`*.test.ts` / `*.spec.ts` beside the module).
- **One-directional dependencies:** `cli → runtime → session-router → sandbox →
agent`. Do not introduce cycles (enforced by `pnpm run check:cycles`).
- Run `pnpm run check` before committing.
