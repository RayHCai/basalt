/**
 * A tiny bounded-concurrency worker pool. The runner fans out many
 * sample×rep attempts, but must not launch them all at once (a real provider
 * would rate-limit, and even the dummy would spike memory on a 128K grid). This
 * runs at most `concurrency` tasks in flight, preserving input order in the
 * results array.
 *
 * No external dependency — the workspace is dependency-light and this is a dozen
 * lines. Each task is a thunk so it is not started until a worker slot frees.
 */

/**
 * Run `tasks` with at most `concurrency` in flight. Resolves to the results in
 * the SAME order as `tasks` (not completion order). A rejecting task rejects the
 * whole call — callers that want per-task error capture should make their thunks
 * resolve to a result object instead of throwing (the runner does exactly this).
 *
 * `concurrency` is clamped to at least 1. An empty task list resolves to `[]`.
 */
async function runPool<T>(tasks: readonly (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = Array.from<T>({ length: tasks.length });
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) {
        return;
      }
      const task = tasks[index];
      if (task === undefined) {
        return;
      }
      // Sequential WITHIN a worker by design: a worker pulls the next task only
      // after its current one settles. Concurrency comes from N workers.
      // oxlint-disable-next-line no-await-in-loop
      results[index] = await task();
    }
  }

  const workerCount = Math.min(limit, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export { runPool };
