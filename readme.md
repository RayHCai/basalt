Basalt is a small, light-weight CLI harness similar to Claude code.

Features:

- Cron
- Event/web hooks
- Multi-agent/parallel sessions

Here's how you interact with the agent:

- `basalt`
  ...... messages

- `basalt sessions`

1. --list -> shows a list of all active session IDs, who the parent is, etc
2. --watch [ID] -> let's you stream the session (can't interact with it)

- `basalt cron`

1. --list -> shows all cron job IDs, when they are happening, and if there is a session ID attached to one (it's in progress)

- `basalt init`

1. Runs the config init setup

Here are some project specific details:

1. pnpm + turbo mono-repo
2. commander CLI tool (including coloring)
3. Typescript + oxlint + prettier
4. Vitetest (keep tests next to source files)

AGENTS:

When adding new code, we should write the tests first, then add the logic.

Here's the project structure. Every workspace member is a package under
`packages/*`. Dependencies flow one direction (leaf -> root):

    cli -> runtime -> session-router -> sandbox -> agent
                          |               |          |
                          +-> storage     +-> config +-> config -> secrets
                                                      +-> observability

```
.github/              CI/CD workflows
pre-commit/           git hook scripts
docs/
    AGENTS.md
    CLAUDE.md
    CONTRIBUTING.md

packages/
    cli/              commander-based entry point + coloring; defines the
                      `basalt`, `basalt sessions`, `basalt cron` sub-commands.
                      Thin: parses args and delegates into runtime.

    runtime/          what `basalt` actually invokes. Wires every package's
                      loader together and owns startup. Connects the full path:
                      cli -> runtime -> session-router -> sandbox -> agent.
        session-router/  routes a task to a session; session creation, task
                         queueing + dedup.

    agent/            core agent harness + loop.
        loop/            runtime-facing entry: accepts one message/task, owns
                         the current session, reads from the task queue.
        harness/         assembles the loop's dependencies.
        memory/          long-term memory.
        context/         per-session memory.
        model-router/    dynamic model routing.
        tools-handler/   loads/executes tools (tool code lives in the state dir). for tools that require secrets/env vars that we don't want to be exposed to the agent, we need to have tools pass through
                            config (and underneath secrets)
        mcp-handler/     loads MCP servers (MCP configs live in config/storage).

    model-provider/    how we load a model/model-provider/3rd party harness. There are a few different ways to interact with model providers. First, we can have a pure API key. Then, we can have
                        an oAuth call (simple q/a repsonse, input/output). Finally, we can have a full 3rd party harness (e.x codex, claude-cli) call. We need to make note of the different ways to interact with a model-provider here

    sandbox/          where an agent loop actually runs; spawned per session.

    storage/          sqlite storage — sessions, cron registry, config/plugin
                      tracking; defines the access methods over it.

    config/           create + manage typed config (built on storage). Defaults,
                      mutation, and typed retriever methods. Owns the base config
                      (state dir) and per-model-provider sections (oAuth, API
                      key, entry point, ...). Passes through secrets/ for
                      anything sensitive.

    secrets/          load + store secrets safely; never exposed to the agent.
                      config/ routes sensitive values through here.

    observability/    logs, metrics, traces (log storage under the state dir).

    evals/            we will run this via `basalt evals` ->
```

### Runtime state directory (`STATE_DIR`).

The STATE_DIR will be defaulted to this current working dir (so .config and .agent will be in the same folder as packages/).

Runtime state does **not** live in the repo — it's rooted at `STATE_DIR`
(defaults to the current project dir for now), managed by `config`/`storage`:

```
<STATE_DIR>/
  .agent/
    tools/            installed tool code (loaded by tools-handler)
    mcps/             installed MCP servers (loaded by mcp-handler)
  .config/            config files (managed by config/)
  .logs/              log output (managed by observability/)
```
