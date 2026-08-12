import { describe, expect, it } from 'vitest';

import { CliError, EXIT_CODES, isCliError, NotFoundError, UsageError } from './errors.js';

describe('CliError', () => {
  it('defaults to the generic failure exit code', () => {
    const err = new CliError('boom');
    expect(err.exitCode).toBe(EXIT_CODES.failure);
    expect(err.message).toBe('boom');
    expect(err).toBeInstanceOf(Error);
  });

  it('accepts an explicit exit code', () => {
    expect(new CliError('boom', EXIT_CODES.usage).exitCode).toBe(EXIT_CODES.usage);
  });
});

describe('UsageError', () => {
  it('uses the usage exit code (2)', () => {
    const err = new UsageError('bad flag');
    expect(err.exitCode).toBe(EXIT_CODES.usage);
    expect(err.name).toBe('UsageError');
    expect(err).toBeInstanceOf(CliError);
  });
});

describe('NotFoundError', () => {
  it('uses the generic failure exit code', () => {
    expect(new NotFoundError('nope').exitCode).toBe(EXIT_CODES.failure);
  });
});

describe('isCliError', () => {
  it('recognizes CliError and its subclasses', () => {
    expect(isCliError(new CliError('x'))).toBe(true);
    expect(isCliError(new UsageError('x'))).toBe(true);
    expect(isCliError(new NotFoundError('x'))).toBe(true);
  });

  it('rejects plain errors and non-errors', () => {
    expect(isCliError(new Error('x'))).toBe(false);
    expect(isCliError('x')).toBe(false);
    expect(isCliError(null)).toBe(false);
  });
});
