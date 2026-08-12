import { describe, expect, it } from 'vitest';

import { activeModels } from './models.js';
import type { ModelInfo } from './models.js';

describe('activeModels', () => {
  it('keeps only the enabled models, in order', () => {
    const models: readonly ModelInfo[] = [
      { name: 'a', enabled: true },
      { name: 'b', enabled: false },
      { name: 'c', enabled: true },
    ];
    expect(activeModels(models)).toEqual([
      { name: 'a', enabled: true },
      { name: 'c', enabled: true },
    ]);
  });

  it('returns an empty array when none are enabled', () => {
    expect(activeModels([{ name: 'a', enabled: false }])).toEqual([]);
  });

  it('returns an empty array for no models', () => {
    expect(activeModels([])).toEqual([]);
  });
});
