#!/usr/bin/env node
import { run } from './run.js';

/**
 * Executable entry point for the `basalt` command. Kept intentionally tiny: it
 * runs the CLI and translates the resolved exit code into a real process exit.
 * All parsing, dispatch, and error rendering live in {@link run}.
 */
const exitCode = await run();
process.exitCode = exitCode;
