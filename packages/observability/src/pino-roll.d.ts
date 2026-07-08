/**
 * Ambient types for `pino-roll@4`, which ships no type declarations of its own.
 * Only the surface Basalt uses is modeled; extend as needed.
 */
declare module 'pino-roll' {
  interface LimitOptions {
    count?: number;
    removeOtherLogFiles?: boolean;
  }

  interface PinoRollOptions {
    /** Base path; rotation number, date and extension are appended. */
    file: string | (() => string);
    /** Max size before rotation, e.g. `'10m'`. */
    size?: number | string;
    /** `'daily'` | `'hourly'` | number of ms. */
    frequency?: number | string;
    /** File extension for rotated files (default `.log`). */
    extension?: string;
    /** date-fns format string, e.g. `'yyyy-MM-dd'`. */
    dateFormat?: string;
    /** Create parent directories if missing. */
    mkdir?: boolean;
    /** Maintain a `current.log` symlink to the active file. */
    symlink?: boolean;
    /** Old-file retention strategy (count-based only). */
    limit?: LimitOptions;
  }

  /**
   * A SonicBoom stream. Typed structurally as the pieces pino needs (a writable
   * with an `end`); the concrete class lives in `sonic-boom`.
   */
  interface SonicBoomStream {
    write: (chunk: string) => boolean;
    end: () => void;
    flushSync: () => void;
    on: (event: string, listener: (...args: unknown[]) => void) => SonicBoomStream;
  }

  /** Build a rotating file stream. Resolves once the underlying file is ready. */
  export default function build(options: PinoRollOptions): Promise<SonicBoomStream>;
}
