# basalt

A TypeScript monorepo built on **pnpm + Turborepo**, with strict typing
(oxlint + a strictest-safe tsconfig), Prettier formatting, dependency hygiene
(knip, import-cycle checks), pre-commit hooks (lefthook), and GitHub Actions CI.
Pinned to **Node 24**.

## Toolchain

- **pnpm + Turborepo** — workspace + task orchestration
- **oxlint** — strong lint rules + a dedicated import-cycle pass
- **tsconfig** — modern, best-practice, strict TypeScript (Node 24 ESM)
- **Prettier** — consistent formatting
- **pnpm hardening** — `overrides` + `minimumReleaseAge` + `allowBuilds` allowlist
- **lefthook** — pre-commit lint/format, pre-push typecheck
- **knip** — dead code / unused dependency detection
- primarily TypeScript; clean, well-managed dependencies

## Folder structure

```
.github/            CI/CD workflows
pre-commit/         bespoke hand-written pre-commit hook scripts
docs/               contribution guides, etc.
scripts/            local scripts

add-ons/            bundled add-ons (data/content, loaded into the JSON contract)
  plugins/          each add-on lives in its own id-named folder
  providers/

apps/
  dashboard/
    mobile/
    backend/
    desktop/

packages/           SDKs and API contracts (workspace packages)
  cli/              base basalt CLI tool, sub-command API contract, and loader
                    (gateway and config register their own sub-commands)
  gateway-protocol/ connection/message contracts
  gateway/          spawns the HTTP + WS service (node HTTP listener, WS base)
  secrets/          load + retrieve secrets safely, never exposed to the agent
  storage/          primary sqlite storage — sessions, config tracking,
                    plugin tracking, etc.; defines access methods
  config/           create + manage config files (built on storage)
    defaults/
  add-on-sdk/       how add-ons are loaded and identified
    plugin-sdk/     plugins — can be loaded anywhere, in any seam
    providers/
      channel-sdk/  channels — force message contracts with the gateway
      tool-sdk/     agent tooling
      mcp-sdk/      MCPs — JSON configs tracked in storage/
      model-sdk/    model-provider contract + loader (input/output, stream,
                    auth); connects to config/. Each model that extends the SDK
                    must create its own config — enforced by the SDK.

integration-tests/  cross-package integration tests

evals/              custom eval suite + runner — copies the gateway into a
                    separate sandbox and runs HTTP fire-and-forget

src/                the core package
  doctor/           config migration, leakage checks, etc.
  agent/            core agent harness + loop
    memory/         long-term memory
    context/        per-session memory
    model-router/   dynamic model router
    tools-handler/
    mcp-handler/
    harness/
    loop/           runtime-facing entry: accepts a single message/task, owns
                    the sandbox env + current session, spawns sandboxes per
                    session, and reads from the task queue
  sandbox/          where agent loops run
  security/         prompt-injection handling, etc.
  observability/    logs, metrics, traces
  session-router/   routes a task to a session; task queueing + dedup
  scheduler/        cron — checking for / registering scheduled events
  hooks/            events — receiving / registering event hooks
  runtime/          full startup logic: (re)initializes the primary agent
                    session, wires every package's loader together, and returns
                    the runtime contract passed into the agent loop (available
                    models, tools, MCPs, ...). Accepts a creation parameter for
                    testing (spins up a test sandbox, loads the gateway there,
                    defines a single test session in storage). Connects the full
                    loop: channels + config -> gateway -> session-router -> loop.
```

### Runtime home directory (`~/.basalt/`)

Installed add-ons and runtime state do **not** live in the repo. At runtime the
`storage`/`config` packages manage:

```
~/.basalt/
  add-ons/
    plugins/
    providers/
```

## Getting started

```sh
pnpm install
pnpm run check   # lint + import-cycles + typecheck + build + format + knip
```

CI runs the same gate on every push / PR to `main`.
