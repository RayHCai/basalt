/**
 * The conversation chain — the agent's working context.
 *
 * A conversation is deliberately the simplest thing that works: an ordered list
 * of completed exchanges, each a `{ message, response }` pair. It carries no
 * roles beyond that, no tool calls, no metadata. The harness serializes this
 * chain into the single `input` string a model provider takes (see
 * `../harness/prompt.ts`), and the memory store persists it across turns (see
 * `../memory/store.ts`).
 *
 * Everything here is pure and immutable: the operations return NEW
 * conversations rather than mutating in place, so a caller can hold onto a prior
 * state safely. Growth is handled by {@link appendTurn}; bounding is handled by
 * {@link dropOldestTurn} (trim from the TOP — drop the oldest first so the most
 * recent context always survives).
 */

/**
 * One completed exchange: the user's `message` and the model's `response`. This
 * is the whole unit of history the agent keeps.
 */
interface Turn {
  /** What the user (or upstream caller) sent. */
  readonly message: string;
  /** What the model replied. */
  readonly response: string;
}

/** An ordered, immutable list of completed {@link Turn}s — oldest first. */
type Conversation = readonly Turn[];

/** The starting point for a new session: a conversation with no turns. */
const EMPTY_CONVERSATION: Conversation = Object.freeze([]);

/**
 * Return a new conversation with `turn` appended after the existing turns. The
 * input is left untouched.
 */
function appendTurn(conversation: Conversation, turn: Turn): Conversation {
  return [...conversation, turn];
}

/**
 * Return a new conversation with the single oldest turn removed. Trimming from
 * the TOP (front) keeps the most recent turns, which are the most relevant
 * context for the next response. A no-op on an empty conversation.
 */
function dropOldestTurn(conversation: Conversation): Conversation {
  return conversation.slice(1);
}

export { appendTurn, type Conversation, dropOldestTurn, EMPTY_CONVERSATION, type Turn };
