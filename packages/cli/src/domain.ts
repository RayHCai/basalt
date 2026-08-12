/**
 * Domain types the CLI renders for the `sessions` and `cron` commands. These
 * describe sessions and cron jobs — data owned by `@basalt/storage` ("sqlite
 * storage — sessions, cron registry"). Storage is not built yet, so the CLI
 * holds the shapes here and reads them through {@link StorageReader} (see
 * `storage.ts`). When `@basalt/storage` lands, these move there and the CLI
 * imports them, unchanged in shape.
 */

/** A live or recently active agent session. */
interface SessionInfo {
  /** Stable session identifier. */
  id: string;
  /** Parent session id, or `null` for a top-level (user-initiated) session. */
  parentId: string | null;
  /** Coarse lifecycle state. */
  status: 'running' | 'idle' | 'done' | 'error';
  /** One-line summary of the task the session is working on. */
  task: string;
  /** ISO-8601 timestamp of when the session started. */
  startedAt: string;
}

/** A registered cron job and its current scheduling state. */
interface CronJobInfo {
  /** Stable cron job identifier. */
  id: string;
  /** Cron schedule expression (e.g. `0 * * * *`). */
  schedule: string;
  /** ISO-8601 timestamp of the next scheduled run. */
  nextRun: string;
  /**
   * The session id currently executing this job, or `null` when the job is idle
   * (not in progress).
   */
  sessionId: string | null;
}

/** A single streamed event from a watched session. */
interface SessionEvent {
  /** ISO-8601 timestamp of the event. */
  at: string;
  /** Event channel (agent message, tool call, status change, ...). */
  kind: string;
  /** Human-readable event text. */
  text: string;
}

export type { CronJobInfo, SessionEvent, SessionInfo };
