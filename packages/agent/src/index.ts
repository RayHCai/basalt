/**
 * `@basalt/agent` — the core agent: harness + loop + a basic conversation
 * context and memory.
 *
 * The runtime invokes {@link start} with a {@link Session} and a user message
 * and receives the agent's reply. The loop is the runtime-facing seam. Behind it
 * sit three small, composable pieces that make up the current "very basic"
 * system:
 *
 *  - **context** — the conversation chain (`[{ message, response }]`) and pure
 *    append/trim operations over it.
 *  - **harness** — prompt assembly (chain + new message → one `input` string)
 *    and context-window fitting (drop the oldest turns until it fits a budget).
 *  - **memory** — per-session persistence of the chain between turns.
 *
 * A turn loads the chain, builds and trims the prompt, calls the session
 * provider, and records the exchange. The remaining readme-listed concerns
 * (model routing, tool/MCP handlers) grow behind the same seam as internal
 * modules under `src/`.
 */
export {
  DEFAULT_MAX_TOKENS,
  DEFAULT_SESSION,
  type GetResponse,
  type Session,
  start,
  type StartOptions,
} from './loop/index.js';

// The conversation chain and the pure operations over it.
export {
  appendTurn,
  type Conversation,
  dropOldestTurn,
  EMPTY_CONVERSATION,
  type Turn,
} from './context/index.js';

// Prompt assembly and context-window fitting.
export {
  ASSISTANT_LABEL,
  buildPrompt,
  CHARS_PER_TOKEN,
  DEFAULT_SYSTEM_PROMPT,
  estimateTokens,
  type FittedPrompt,
  fitToBudget,
  USER_LABEL,
} from './harness/index.js';

// Per-session conversation persistence.
export { type ConversationStore, InMemoryConversationStore } from './memory/index.js';
