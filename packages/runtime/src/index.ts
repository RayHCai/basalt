/**
 * `@basalt/runtime` — the layer `basalt` invokes to RUN THE AGENT. It wires the
 * agent stack together (`cli → runtime → session-router → agent-workspace →
 * agent`) and owns startup.
 *
 * The public surface is intentionally a single {@link run} function that takes a
 * {@link RuntimeRequest} and resolves to the matching result. Its scope is agent
 * execution only — the read-only/management subcommands (`sessions`, `cron`,
 * `init`) are owned by their packages (`@basalt/storage`, `@basalt/config`) and
 * the CLI calls those directly, not through here.
 *
 * The lower layers are still being built, so `run` is a THIN first cut (see
 * `run.ts`): a `sendMessage` configures the shared config store and runs one
 * agent-loop turn against dummy session data, returning the reply. The
 * {@link NotImplementedError} taxonomy is kept for the operations that are still
 * shells.
 */
export {
  NoPrimarySessionError,
  NotImplementedError,
  RuntimeError,
  SessionCancelledError,
  StalePrimarySessionError,
} from './errors.js';
export {
  run,
  type RunOptions,
  type RuntimeRequest,
  type RuntimeRequestKind,
  type RuntimeResult,
  type RuntimeResultMap,
  type SendMessageRequest,
} from './run.js';
export {
  type PrimaryService,
  type ResolvePrimaryOptions,
  resolvePrimary,
  type StartPrimaryOptions,
  startPrimary,
} from './service.js';

// Re-export the agent Session type for consumer convenience (the CLI and other
// callers need it for the resolved primary without depending on @basalt/agent).
export type { Session } from '@basalt/agent';
