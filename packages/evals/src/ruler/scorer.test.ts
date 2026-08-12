import { describe, expect, it } from 'vitest';

import type { Sample, Task } from '../task.js';
import { countMatches, referencePresent, scoreOutput } from './scorer.js';

/** A minimal sample for focused scorer assertions. */
function sample(answers: readonly string[], task: Task = 'niah_single_1'): Sample {
  return {
    id: `${task}/8192/0`,
    task,
    nominalLength: 8192,
    index: 0,
    input: 'irrelevant',
    answers,
    answerPrefix: '',
    inputTokens: 1,
  };
}

describe('referencePresent', () => {
  it('is a plain case-insensitive substring test (RULER semantics)', () => {
    expect(referencePresent('The answer is 314159.', '314159')).toBe(true);
    expect(referencePresent('the MEADOW', 'meadow')).toBe(true);
    // Unlike token matching, RULER matches substrings inside longer runs.
    expect(referencePresent('code 3141592', '314159')).toBe(true);
    expect(referencePresent('nothing here', '314159')).toBe(false);
  });
});

describe('countMatches', () => {
  it('counts how many references are present', () => {
    expect(countMatches('a and c', ['a', 'b', 'c'])).toBe(2);
  });
});

describe('scoreOutput — string_match_all (non-QA tasks)', () => {
  it('scores full recall as 1 and passes', () => {
    const result = scoreOutput(sample(['314159']), 'It is 314159.');
    expect(result.score).toBe(1);
    expect(result.passed).toBe(true);
  });

  it('awards partial recall but fails below full recall', () => {
    const multi = sample(['111111', '222222', '333333', '444444'], 'niah_multivalue');
    const result = scoreOutput(multi, 'I found 111111 and 222222.');
    expect(result.matched).toBe(2);
    expect(result.score).toBe(0.5);
    expect(result.passed).toBe(false);
  });

  it('passes a multivalue task at full recall', () => {
    const multi = sample(['111111', '222222'], 'niah_multivalue');
    expect(scoreOutput(multi, '222222, 111111').passed).toBe(true);
  });
});

describe('scoreOutput — string_match_part (QA tasks)', () => {
  it('scores 1 if ANY reference is present (not fractional)', () => {
    const qa = sample(['Rivertown', 'the city of Rivertown'], 'qa_1');
    const result = scoreOutput(qa, 'The capital is Rivertown.');
    // Only one of the two refs is present, but part-match gives full credit.
    expect(result.matched).toBe(1);
    expect(result.score).toBe(1);
    expect(result.passed).toBe(true);
  });

  it('scores 0 when no reference is present', () => {
    const qa = sample(['Rivertown'], 'qa_1');
    expect(scoreOutput(qa, 'The capital is Elsewhere.').score).toBe(0);
  });
});

describe('scoreOutput — edge cases', () => {
  it('an empty output scores 0', () => {
    expect(scoreOutput(sample(['314159']), '').score).toBe(0);
  });

  it('an empty reference set scores 0 (no divide-by-zero)', () => {
    expect(scoreOutput(sample([]), 'anything').score).toBe(0);
  });

  it('the dummy constant "test" fails a real sample', () => {
    expect(scoreOutput(sample(['314159']), 'test').passed).toBe(false);
  });
});
