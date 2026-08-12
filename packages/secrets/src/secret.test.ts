import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { isSecret, REDACTED, Secret } from './secret.js';

describe('Secret', () => {
  it('exposes the underlying value only via expose()', () => {
    const s = new Secret('hunter2');
    expect(s.expose()).toBe('hunter2');
  });

  it('redacts in String()/template coercion', () => {
    const s = new Secret('hunter2');
    expect(String(s)).toBe(REDACTED);
    expect(`${s}`).toBe(REDACTED);
    expect(`${s}`).not.toContain('hunter2');
  });

  it('redacts under JSON.stringify (never serializes the value)', () => {
    const s = new Secret('hunter2');
    expect(JSON.stringify(s)).toBe(`"${REDACTED}"`);
    expect(JSON.stringify({ token: s })).toBe(`{"token":"${REDACTED}"}`);
    expect(JSON.stringify({ token: s })).not.toContain('hunter2');
  });

  it('redacts under util.inspect / console logging', () => {
    const s = new Secret('hunter2');
    expect(inspect(s)).not.toContain('hunter2');
    expect(inspect(s)).toContain(REDACTED);
    // Nested inside an object (how a logger would see it).
    expect(inspect({ apiKey: s }, { depth: 5 })).not.toContain('hunter2');
  });

  it('does not leak the value through enumerable own properties', () => {
    const s = new Secret('hunter2');
    expect(Object.keys(s)).not.toContain('hunter2');
    expect(JSON.stringify(Object.entries(s))).not.toContain('hunter2');
    for (const key of Object.keys(s)) {
      expect(inspect((s as unknown as Record<string, unknown>)[key])).not.toContain('hunter2');
    }
  });

  it('does not carry the value across a structuredClone / worker boundary', () => {
    const s = new Secret('hunter2');
    // The secret lives in a private field, so a structuredClone (what
    // postMessage to an agent worker does) copies an empty husk — the value
    // never crosses the boundary. Some runtimes throw instead; both are safe.
    // oxlint-disable-next-line init-declarations
    let clonedText: string;
    try {
      clonedText = JSON.stringify(structuredClone(s) ?? {});
    } catch {
      clonedText = '';
    }
    expect(clonedText).not.toContain('hunter2');
  });

  it('reports its length without revealing content', () => {
    const s = new Secret('hunter2');
    expect(s.length).toBe(7);
  });

  it('compares in constant time via equals()', () => {
    const s = new Secret('hunter2');
    expect(s.equals('hunter2')).toBe(true);
    expect(s.equals('hunter3')).toBe(false);
    expect(s.equals('different-length')).toBe(false);
    expect(s.equals(new Secret('hunter2'))).toBe(true);
  });

  it('map() derives a new Secret without exposing the source to callers', () => {
    const s = new Secret('  hunter2  ');
    const trimmed = s.map((v) => v.trim());
    expect(isSecret(trimmed)).toBe(true);
    expect(trimmed.expose()).toBe('hunter2');
    expect(String(trimmed)).toBe(REDACTED);
  });

  it('isSecret narrows only genuine Secret instances', () => {
    expect(isSecret(new Secret('x'))).toBe(true);
    expect(isSecret('x')).toBe(false);
    expect(isSecret(null)).toBe(false);
    expect(isSecret({ expose: () => 'x' })).toBe(false);
  });

  it('rejects a non-string value at construction', () => {
    // @ts-expect-error runtime guard for untyped callers
    expect(() => new Secret(123)).toThrow(TypeError);
  });
});
