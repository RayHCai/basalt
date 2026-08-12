import { describe, expect, it } from 'vitest';

import { EvalConfigError, EvalError, EvalResultError } from './errors.js';

describe('error taxonomy', () => {
  it('EvalConfigError and EvalResultError are EvalErrors', () => {
    expect(new EvalConfigError('bad')).toBeInstanceOf(EvalError);
    expect(new EvalResultError('bad')).toBeInstanceOf(EvalError);
  });

  it('carries a name and message', () => {
    const err = new EvalConfigError('out of range');
    expect(err.name).toBe('EvalConfigError');
    expect(err.message).toBe('out of range');
  });

  it('preserves a cause', () => {
    const cause = new Error('root');
    const err = new EvalResultError('wrapped', { cause });
    expect(err.cause).toBe(cause);
  });
});
