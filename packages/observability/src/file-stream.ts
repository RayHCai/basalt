import buildRollingStream from 'pino-roll';

import { logFileBase } from './paths.js';

/** Default size threshold at which a single log file is rotated. */
const DEFAULT_MAX_FILE_SIZE = '10m';

/** date-fns format for the date segment of rotated file names. */
const DATE_FORMAT = 'yyyy-MM-dd';

/** Options for {@link createFileStream}. */
interface FileStreamOptions {
  /** Base log path (e.g. `<STATE_DIR>/.logs/basalt`). Defaults from env. */
  file?: string | undefined;
  /** Size threshold before rotation, e.g. `'10m'`. */
  maxFileSize?: string | number | undefined;
  /** Env map used to derive the default file path. */
  env?: Readonly<Record<string, string | undefined>> | undefined;
}

/**
 * Create the rotating JSONL file stream.
 *
 * Runs pino-roll in-thread (its SonicBoom stream is later fed to
 * `pino.multistream`), which avoids the worker-thread structured-clone boundary
 * of `pino.transport`. Files rotate on **both** size (`maxFileSize`) and calendar
 * day (`frequency: 'daily'`); the date segment uses pino-roll's native
 * `dateFormat`, which formats in local time — so a file's date is the local
 * calendar day it was opened. `mkdir` creates `<STATE_DIR>/.logs` on demand, and
 * numbering resumes from the highest existing file so a restart appends rather
 * than clobbers.
 */
async function createFileStream(options: FileStreamOptions = {}): Promise<NodeJS.WritableStream> {
  const file = options.file ?? logFileBase(options.env);
  const stream = await buildRollingStream({
    file,
    size: options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
    frequency: 'daily',
    dateFormat: DATE_FORMAT,
    extension: '.log',
    mkdir: true,
  });
  return stream as unknown as NodeJS.WritableStream;
}

export { createFileStream };
