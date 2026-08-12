import { describe, expect, it } from 'vitest';

import { NotImplementedError, RuntimeError } from './errors.js';

describe('RuntimeError', () => {
  it('is a plain Error subclass carrying the message', () => {
    const err = new RuntimeError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('boom');
    expect(err.name).toBe('RuntimeError');
  });
});

describe('NotImplementedError', () => {
  it('names the feature and extends RuntimeError', () => {
    const err = new NotImplementedError('sending a message');
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.message).toBe('sending a message is not implemented yet');
    expect(err.name).toBe('NotImplementedError');
  });
});
