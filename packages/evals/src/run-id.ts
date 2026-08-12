import { EvalConfigError } from './errors.js';

/**
 * Run identifiers: a sortable, filesystem-safe slug that names a stored run.
 *
 * A run id is `run-<timestamp>-<provider>`, where the timestamp is
 * `YYYYMMDDTHHMMSS` (UTC, no punctuation) so lexical order matches chronological
 * order and the id is a legal file name on every platform. The timestamp is
 * passed IN (not read from the clock here) so the id is deterministic in tests
 * and the store controls the single source of "now".
 */

/**
 * Characters allowed in a run id: a conservative, cross-platform slug set. The
 * explicit `RegExp` annotation is required by `isolatedDeclarations` (this const
 * is exported).
 */
// oxlint-disable-next-line no-inferrable-types -- required by isolatedDeclarations on an exported const
const RUN_ID_PATTERN: RegExp = /^[A-Za-z0-9._-]+$/u;

/** Format an epoch-millis timestamp as a compact UTC slug `YYYYMMDDTHHMMSS`. */
function formatTimestamp(epochMs: number): string {
  // toISOString yields e.g. 2026-07-12T17:41:12.123Z; strip punctuation and the
  // millisecond/zone tail to leave 20260712T174112.
  const iso = new Date(epochMs).toISOString();
  return iso.slice(0, 19).replaceAll(/[-:]/gu, '');
}

/**
 * Build a run id from a timestamp and provider name. The provider is slugified
 * (non-slug characters collapsed to `-`) so an arbitrary provider name can't
 * produce an illegal path.
 */
function makeRunId(epochMs: number, provider: string): string {
  // Slug set here EXCLUDES the dot so a name like `weird/../name` can never
  // reintroduce a `..` traversal sequence (dots are legal in a run id overall,
  // just not needed in a provider slug).
  const slugProvider = provider.replaceAll(/[^A-Za-z0-9_-]+/gu, '-').replaceAll(/^-+|-+$/gu, '');
  const base = slugProvider.length > 0 ? slugProvider : 'provider';
  return `run-${formatTimestamp(epochMs)}-${base}`;
}

/**
 * Assert that `runId` is a legal slug (guards against path traversal when a run
 * id reaches the filesystem). Throws {@link EvalConfigError} otherwise.
 */
function assertValidRunId(runId: string): void {
  if (runId.length === 0 || !RUN_ID_PATTERN.test(runId) || runId.includes('..')) {
    throw new EvalConfigError(`Invalid run id: ${JSON.stringify(runId)}`);
  }
}

export { assertValidRunId, formatTimestamp, makeRunId, RUN_ID_PATTERN };
