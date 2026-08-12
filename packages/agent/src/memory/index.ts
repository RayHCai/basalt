/**
 * `memory` — where a session's conversation chain persists between turns.
 *
 * The loop reads the stored chain before a turn and records the new turn after.
 * {@link ConversationStore} is the seam a durable implementation drops into;
 * {@link InMemoryConversationStore} is the process-memory default used for the
 * current single-process bring-up.
 */
export { type ConversationStore, InMemoryConversationStore } from './store.js';
