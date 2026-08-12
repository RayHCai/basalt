import type { CellMetrics, RunRecord } from './record.js';
import { TASKS } from './task.js';
import type { Task } from './task.js';
import { CONTEXT_LENGTHS, formatLength } from './tokens.js';
import type { ContextLength } from './tokens.js';

/**
 * The report: turn stored {@link RunRecord}s into text a human reads in the
 * terminal — an accuracy-vs-tokens scatter across runs plus the per-cell metric
 * table. Pure string-building, no IO and no color (the CLI owns writing and
 * palette application, mirroring `@basalt/cli`'s `render.ts`): value in, plain
 * multi-line string out. Kept pure so the (fiddly) layout logic is unit-testable.
 */

/** How wide the scatter plot is drawn, in characters (excluding axis labels). */
const PLOT_WIDTH = 48;

/** How tall the scatter plot is drawn, in rows (excluding axis labels). */
const PLOT_HEIGHT = 12;

/** A single point on the accuracy-vs-tokens plot: one run's overall summary. */
interface ScatterPoint {
  /** The run id (series label). */
  readonly runId: string;
  /** Mean input tokens per attempt (x-axis). */
  readonly meanInputTokens: number;
  /** Overall accuracy in `[0, 1]` (y-axis). */
  readonly accuracy: number;
}

/** Reduce each run to its plottable point. */
function toScatterPoints(records: readonly RunRecord[]): ScatterPoint[] {
  return records.map((record) => ({
    runId: record.runId,
    meanInputTokens: record.metrics.meanInputTokens,
    accuracy: record.metrics.accuracy,
  }));
}

/**
 * Render an ASCII accuracy-vs-tokens scatter. The y-axis is accuracy `0..1`, the
 * x-axis is mean input tokens `0..max`. Each run is plotted with a distinct
 * marker character; a legend maps markers to run ids. An empty input yields a
 * short "no runs" note.
 */
function renderScatter(points: readonly ScatterPoint[]): string {
  if (points.length === 0) {
    return 'No runs to plot.';
  }
  const maxTokens = Math.max(1, ...points.map((p) => p.meanInputTokens));
  const markers = '#*+o@x%=';

  // grid[row][col], row 0 = top (accuracy 1.0).
  const grid: string[][] = Array.from({ length: PLOT_HEIGHT }, () =>
    Array.from({ length: PLOT_WIDTH }, () => ' '),
  );
  points.forEach((point, index) => {
    const col = Math.min(
      PLOT_WIDTH - 1,
      Math.round((point.meanInputTokens / maxTokens) * (PLOT_WIDTH - 1)),
    );
    const clampedAccuracy = Math.max(0, Math.min(1, point.accuracy));
    const row = Math.min(PLOT_HEIGHT - 1, Math.round((1 - clampedAccuracy) * (PLOT_HEIGHT - 1)));
    const marker = markers[index % markers.length] ?? '#';
    (grid[row] as string[])[col] = marker;
  });

  const lines: string[] = ['Accuracy vs. input tokens'];
  for (let row = 0; row < PLOT_HEIGHT; row += 1) {
    // Label the top, middle, and bottom rows with their accuracy value.
    const axisValue = 1 - row / (PLOT_HEIGHT - 1);
    const label =
      row === 0 || row === PLOT_HEIGHT - 1 || row === Math.floor((PLOT_HEIGHT - 1) / 2)
        ? axisValue.toFixed(1)
        : '   ';
    lines.push(`${label.padStart(3)} |${(grid[row] as string[]).join('')}`);
  }
  lines.push(
    `    +${'-'.repeat(PLOT_WIDTH)}`,
    `     0${' '.repeat(PLOT_WIDTH - 6)}${formatTokens(maxTokens)}`,
  );

  // Legend — build every line first, then append in one call.
  const legend = points.map((point, index) => {
    const marker = markers[index % markers.length] ?? '#';
    return `  ${marker}  ${point.runId}  (acc ${formatPct(point.accuracy)}, ~${formatTokens(point.meanInputTokens)} tok)`;
  });
  lines.push('', ...legend);
  return lines.join('\n');
}

/** Format a token count compactly (e.g. `8192` → `8.2K`). */
function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return Math.round(tokens).toString();
}

/** Format a `[0,1]` fraction as a percentage string. */
function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/**
 * Render one run's per-`(task, length)` metric table. Rows are tasks in
 * canonical order, columns are the context lengths present, cells show accuracy.
 * A trailing summary line reports overall accuracy and mean tokens.
 */
function renderTable(record: RunRecord): string {
  const lengths = presentLengths(record);
  const byCell = indexCells(record.metrics.cells);
  const tasks = presentTasks(record);

  const header = ['task'.padEnd(16), ...lengths.map((l) => formatLength(l).padStart(8))].join(' ');
  const rows = tasks.map((task) => {
    const cells = lengths.map((length) => {
      const cell = byCell.get(cellKey(task, length));
      return (cell === undefined ? '-' : formatPct(cell.accuracy)).padStart(8);
    });
    return [task.padEnd(16), ...cells].join(' ');
  });

  const summary = `overall accuracy ${formatPct(record.metrics.accuracy)}  ·  mean input ${formatTokens(record.metrics.meanInputTokens)} tok  ·  mean output ${formatTokens(record.metrics.meanOutputTokens)} tok  ·  ${record.metrics.attempts.toString()} attempts`;

  return [
    `Run ${record.runId}  (${record.params.provider}/${record.params.model})`,
    header,
    ...rows,
    '',
    summary,
  ].join('\n');
}

/** The distinct context lengths present in a record, in canonical order. */
function presentLengths(record: RunRecord): ContextLength[] {
  const present = new Set(record.metrics.cells.map((cell) => cell.nominalLength));
  return CONTEXT_LENGTHS.filter((length) => present.has(length));
}

/** The distinct tasks present in a record, in canonical order. */
function presentTasks(record: RunRecord): Task[] {
  const present = new Set(record.metrics.cells.map((cell) => cell.task));
  return TASKS.filter((task) => present.has(task));
}

/** Index cells by `(task, length)` for O(1) table lookup. */
function indexCells(cells: readonly CellMetrics[]): Map<string, CellMetrics> {
  const map = new Map<string, CellMetrics>();
  for (const cell of cells) {
    map.set(cellKey(cell.task, cell.nominalLength), cell);
  }
  return map;
}

/** The composite key used to index a cell. */
function cellKey(task: Task, length: ContextLength): string {
  return `${task}/${length.toString()}`;
}

/**
 * Render the full report for a set of stored runs: the accuracy-vs-tokens
 * scatter across all runs, then each run's metric table (most recent last, the
 * order `loadAllRuns` returns). An empty set yields a friendly note.
 */
function renderReport(records: readonly RunRecord[]): string {
  if (records.length === 0) {
    return 'No eval runs found. Run `basalt evaluate` first.';
  }
  const scatter = renderScatter(toScatterPoints(records));
  const tables = records.map((record) => renderTable(record));
  return [scatter, '', ...interleave(tables)].join('\n');
}

/** Join tables with a blank separator line between each. */
function interleave(tables: readonly string[]): string[] {
  const out: string[] = [];
  tables.forEach((table, index) => {
    if (index > 0) {
      out.push('');
    }
    out.push(table);
  });
  return out;
}

export { renderReport, renderScatter, renderTable, type ScatterPoint, toScatterPoints };
