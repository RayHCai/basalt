import type { Conversation, Turn } from '../context/index.js';
import { appendTurn, EMPTY_CONVERSATION } from '../context/index.js';

/**
 * Memory — where a session's conversation chain lives BETWEEN turns.
 *
 * The loop is otherwise stateless: each call to `start` builds a prompt, gets a
 * response, and records the new turn. The store is what carries the chain from
 * one call to the next, keyed by session id. This is the seam a durable
 * (disk/db-backed) implementation drops into later; for now it's a plain
 * in-memory map, which is all the single-process bring-up needs.
 */

/**
 * Per-session conversation persistence. A store owns the mapping from a session
 * id to its {@link Conversation}; the loop reads it before a turn and records
 * the new turn after.
 */
interface ConversationStore {
  /** The stored conversation for `sessionId`, or the empty conversation if none yet. */
  readonly load: (sessionId: string) => Promise<Conversation>;
  /** Append `turn` to `sessionId`'s conversation and return the new state. */
  readonly append: (sessionId: string, turn: Turn) => Promise<Conversation>;
}

/**
 * The simplest {@link ConversationStore}: a `Map` held in process memory. History
 * lives only as long as the process; a restart starts every session fresh. Fine
 * for the current single-process, single-run bring-up — swap in a persistent
 * store when sessions must survive across runs.
 */
class InMemoryConversationStore implements ConversationStore {
  readonly #conversations = new Map<string, Conversation>();

  // oxlint-disable-next-line require-await -- satisfies the async ConversationStore contract; a disk-backed store will actually await
  async load(sessionId: string): Promise<Conversation> {
    return this.#conversations.get(sessionId) ?? EMPTY_CONVERSATION;
  }

  // oxlint-disable-next-line require-await -- satisfies the async ConversationStore contract; a disk-backed store will actually await
  async append(sessionId: string, turn: Turn): Promise<Conversation> {
    const next = appendTurn(this.#conversations.get(sessionId) ?? EMPTY_CONVERSATION, turn);
    this.#conversations.set(sessionId, next);
    return next;
  }
}

export { type ConversationStore, InMemoryConversationStore };
