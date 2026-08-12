/**
 * The per-session state the loop runs against.
 *
 * This is intentionally minimal for now — just enough to name WHICH model
 * provider and model a turn should go to. The runtime hands the loop a session
 * (today the {@link DEFAULT_SESSION} bring-up default); as the agent stack is
 * built out this grows to carry the task queue, conversation history, memory
 * handles, tool/MCP registries, and so on.
 */
interface Session {
  /** Stable identifier for the session (opaque; used for logging/correlation). */
  readonly id: string;
  /** The configured model-provider NAME the loader resolves for this session. */
  readonly provider: string;
  /** The model identifier passed to the provider's `getResponse`. */
  readonly model: string;
}

/**
 * The default session the runtime runs a turn against until real session
 * creation, routing, and persistence are wired through. It exercises the loop's
 * **API path** (`start` fixes the auth type to `'API'`) against the `anthropic`
 * provider's `claude-haiku-4-5` model — the cheapest current model, chosen to
 * keep this straight-through bring-up turn inexpensive.
 *
 * Requires the `anthropic` provider to be configured: its config section seeded
 * (`config/model-providers/anthropic.json`, `source: anthropic.ts`) and its API
 * key sealed (`basalt secret set anthropic-api-key`). Without those the loader /
 * provider raises a clear error when a turn runs.
 */
const DEFAULT_SESSION: Session = {
  id: 'default-session',
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
};

export { DEFAULT_SESSION, type Session };
