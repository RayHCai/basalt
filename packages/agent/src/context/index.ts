/**
 * `context` — the agent's working conversation and the pure operations over it.
 *
 * The conversation chain (`[{ message, response }]`) is the shared shape the
 * whole agent revolves around: the harness serializes it into a prompt, the
 * loop appends to it each turn, and the memory store persists it. This module
 * owns that type and the immutable append/trim operations on it.
 */
export {
  appendTurn,
  type Conversation,
  dropOldestTurn,
  EMPTY_CONVERSATION,
  type Turn,
} from './conversation.js';
