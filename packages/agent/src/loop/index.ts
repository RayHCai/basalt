/**
 * The agent loop — the runtime-facing entry to running the agent.
 *
 * {@link start} runs one turn for a {@link Session} and a user message and
 * returns the reply. It drives the basic conversation system: load the session's
 * chain from memory, assemble + trim the prompt via the harness, call the
 * provider, and record the new turn. The task queue, tools, and model routing
 * grow behind this same seam. The default turn runs against the
 * {@link DEFAULT_SESSION} (the `anthropic` provider's `claude-haiku-4-5` over the
 * API path).
 */
export { DEFAULT_MAX_TOKENS, type GetResponse, start, type StartOptions } from './start.js';
export { DEFAULT_SESSION, type Session } from './session.js';
