/**
 * `harness` — prompt assembly and context-window fitting.
 *
 * The harness sits between the conversation chain and the model provider: it
 * renders the chain plus the new message into the single `input` string a
 * provider takes ({@link buildPrompt}), and trims the oldest turns off until
 * that string fits a token budget ({@link fitToBudget}). Everything here is pure
 * — the loop owns the state, the harness just shapes it.
 */
export { ASSISTANT_LABEL, buildPrompt, DEFAULT_SYSTEM_PROMPT, USER_LABEL } from './prompt.js';
export { CHARS_PER_TOKEN, estimateTokens, type FittedPrompt, fitToBudget } from './fit.js';
