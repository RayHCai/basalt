import { describe, expect, it } from 'vitest';

import {
  ModelProviderError,
  ProviderNotImplementedError,
  UnsupportedAuthMethodError,
} from './errors.js';

describe('error taxonomy', () => {
  it('UnsupportedAuthMethodError extends the base and carries labels', () => {
    const error = new UnsupportedAuthMethodError('anthropic', 'oAuth');
    expect(error).toBeInstanceOf(ModelProviderError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('UnsupportedAuthMethodError');
    expect(error.provider).toBe('anthropic');
    expect(error.method).toBe('oAuth');
    expect(error.message).toContain('anthropic');
    expect(error.message).toContain('oAuth');
  });

  it('ProviderNotImplementedError extends the base', () => {
    const error = new ProviderNotImplementedError('harness response');
    expect(error).toBeInstanceOf(ModelProviderError);
    expect(error.name).toBe('ProviderNotImplementedError');
    expect(error.message).toContain('harness response');
  });

  it('ModelProviderError sets its own name', () => {
    const error = new ModelProviderError('boom');
    expect(error.name).toBe('ModelProviderError');
    expect(error.message).toBe('boom');
  });
});
