import type { Conversation } from '../context/index.js';
import { dropOldestTurn } from '../context/index.js';

import { buildPrompt } from './prompt.js';

/**
 * Fitting the prompt to a budget — the "if it exceeds context length, cut from
 * the top" rule.
 *
 * The loop can't send an unbounded transcript to the model, so before each turn
 * the harness trims the OLDEST turns off the conversation until the assembled
 * prompt fits within a token budget. Only history is dropped; the system
 * preamble and the new message are always kept — if even they don't fit, the
 * result is the smallest possible prompt (empty history) and it's the caller's
 * problem, not something we can silently fix by dropping the actual question.
 */

/**
 * Rough characters-per-token ratio used by {@link estimateTokens}. Four is the
 * usual back-of-envelope figure for English text under common BPE tokenizers.
 * This is an ESTIMATE, not a real tokenizer — good enough to bound the prompt
 * without pulling in a tokenizer dependency; swap in a real count per provider
 * later if precision matters.
 */
const CHARS_PER_TOKEN = 4;

/** Estimate the token count of `text` from its length. See {@link CHARS_PER_TOKEN}. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** The trimmed conversation plus the prompt built from it. */
interface FittedPrompt {
  /** The (possibly trimmed) conversation the prompt was built from. */
  readonly conversation: Conversation;
  /** The assembled prompt string, within `maxTokens` when possible. */
  readonly prompt: string;
  /** How many oldest turns were dropped to make it fit. */
  readonly dropped: number;
}

/**
 * Build a prompt from `system` + `conversation` + `message`, dropping the oldest
 * turns one at a time until the estimated token count is within `maxTokens`.
 *
 * Stops when the prompt fits OR the conversation is empty — whichever comes
 * first. An empty conversation is the floor: the system preamble and the new
 * message are never dropped, so a caller always gets a prompt that at least
 * carries the current question, even if it exceeds the budget on its own.
 */
function fitToBudget(
  system: string,
  conversation: Conversation,
  message: string,
  maxTokens: number,
): FittedPrompt {
  let current = conversation;
  let prompt = buildPrompt(system, current, message);
  let dropped = 0;

  while (estimateTokens(prompt) > maxTokens && current.length > 0) {
    current = dropOldestTurn(current);
    prompt = buildPrompt(system, current, message);
    dropped += 1;
  }

  return { conversation: current, prompt, dropped };
}

export { CHARS_PER_TOKEN, estimateTokens, type FittedPrompt, fitToBudget };
