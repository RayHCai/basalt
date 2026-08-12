/**
 * A clock returning the current time as an ISO-8601 string (e.g.
 * `2026-07-14T12:00:00.000Z`). Injectable so a store's `createdAt`/`updatedAt`
 * timestamps are deterministic under test.
 */
type Clock = () => string;

/** The default wall-clock: `new Date().toISOString()`. */
const systemClock: Clock = () => new Date().toISOString();

export { type Clock, systemClock };
