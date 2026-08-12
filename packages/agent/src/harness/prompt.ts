import type { Conversation } from '../context/index.js';

/**
 * Prompt building — turning the conversation chain plus the new message into the
 * single `input` string a model provider's `getResponse` takes.
 *
 * This is deliberately the simplest possible assembly: a fixed system preamble,
 * then the transcript rendered as alternating `User:` / `Assistant:` lines, then
 * the new user message with a trailing `Assistant:` cue for the model to
 * continue from. No message objects, no roles API — just text in, text out. A
 * provider that wants richer structure can parse this back out later; for now it
 * keeps the whole path a plain string.
 */

/**
 * The default system preamble prepended to every prompt. Intentionally terse —
 * it only sets the frame; real behavior lives in the model and, later, in
 * configured instructions the harness will splice in here.
 */
const DEFAULT_SYSTEM_PROMPT = 'You are Basalt, a helpful AI assistant.';

/** Label prefixing a user message in the rendered transcript. */
const USER_LABEL = 'User';
/** Label prefixing a model response in the rendered transcript. */
const ASSISTANT_LABEL = 'Assistant';

/** Render one completed exchange as two labeled lines. */
function renderTurn(message: string, response: string): string {
  return `${USER_LABEL}: ${message}\n${ASSISTANT_LABEL}: ${response}`;
}

/**
 * Assemble the full prompt string from a system preamble, the prior
 * `conversation`, and the new user `message`.
 *
 * Shape:
 * ```
 * <system>
 *
 * User: <turn 1 message>
 * Assistant: <turn 1 response>
 * ...
 * User: <message>
 * Assistant:
 * ```
 *
 * The trailing `Assistant:` with nothing after it is the cue the model
 * completes. When there is no history the transcript section is just the new
 * message.
 */
function buildPrompt(system: string, conversation: Conversation, message: string): string {
  const history = conversation.map((turn) => renderTurn(turn.message, turn.response));
  const transcript = [...history, `${USER_LABEL}: ${message}`, `${ASSISTANT_LABEL}:`].join('\n');
  return `${system}\n\n${transcript}`;
}

export { ASSISTANT_LABEL, buildPrompt, DEFAULT_SYSTEM_PROMPT, USER_LABEL };
