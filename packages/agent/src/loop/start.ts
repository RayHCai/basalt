import { getResponse as loaderGetResponse } from '@basalt/model-provider';
import { getLogger } from '@basalt/observability';
import type { Logger } from '@basalt/observability';

import { DEFAULT_SYSTEM_PROMPT, fitToBudget } from '../harness/index.js';
import { InMemoryConversationStore } from '../memory/index.js';
import type { ConversationStore } from '../memory/index.js';

import type { Session } from './session.js';

/**
 * The runtime-facing entry to the agent loop.
 *
 * The runtime calls {@link start} with a {@link Session} and one user message,
 * and gets back the agent's reply. This is the seam the rest of the agent grows
 * behind: it will eventually own the current session and drain a task queue,
 * running many turns.
 *
 * Today it runs one turn over the basic conversation system:
 *   1. Load the session's conversation chain from the memory store.
 *   2. Assemble the prompt (system preamble + transcript + new message) and
 *      trim the oldest turns until it fits the context budget (harness).
 *   3. Send that prompt to the session's configured provider (API auth) and get
 *      the response.
 *   4. Record the `{ message, response }` turn back into the store so the next
 *      turn sees it.
 *
 * With the `dummy` provider wired, any input yields the constant `"test"` —
 * enough to keep the whole `cli → runtime → agent → model-provider` path online.
 */

/**
 * The model-provider call the loop makes. Matches `@basalt/model-provider`'s
 * `getResponse` (provider, model, input, auth type). Injectable so a test can
 * drive the loop without a configured provider on disk.
 */
type GetResponse = (
  provider: string,
  model: string,
  input: string,
  type: 'API' | 'oAuth',
) => Promise<string>;

/**
 * Default context-window budget, in estimated tokens, the prompt is trimmed to
 * fit before each turn. A conservative floor that suits every current model;
 * later this comes from the session's model info rather than a constant.
 */
const DEFAULT_MAX_TOKENS = 8000;

/** Options for {@link start}, all optional — sensible process-backed defaults. */
interface StartOptions {
  /** Model-provider entry point. Defaults to `@basalt/model-provider`'s `getResponse`. */
  getResponse?: GetResponse;
  /** Logger to use. Defaults to a subsystem logger tagged `agent`. */
  logger?: Logger;
  /**
   * Conversation persistence across turns. Defaults to a shared, process-memory
   * store (see {@link DEFAULT_STORE}); a caller supplies its own to isolate or
   * persist history.
   */
  store?: ConversationStore;
  /** System preamble prepended to the prompt. Defaults to {@link DEFAULT_SYSTEM_PROMPT}. */
  system?: string;
  /** Context-window budget (estimated tokens) the prompt is trimmed to fit. */
  maxTokens?: number;
}

/**
 * The process-wide default conversation store. A single in-memory store shared
 * across `start` calls so history accumulates within a run when no store is
 * injected. Replaced by a durable store once sessions must outlive the process.
 */
const DEFAULT_STORE: ConversationStore = new InMemoryConversationStore();

/**
 * Run one turn of the agent loop for `message` against `session`, returning the
 * agent's reply.
 *
 * Loads the session's conversation, builds and trims the prompt to fit the
 * context budget, sends it to the session's provider (API auth — the only path
 * the current bring-up implements), then records the new turn so the next call
 * carries this exchange as context.
 */
async function start(
  session: Session,
  message: string,
  options: StartOptions = {},
): Promise<string> {
  const getResponse = options.getResponse ?? loaderGetResponse;
  const logger = options.logger ?? getLogger('agent');
  const store = options.store ?? DEFAULT_STORE;
  const system = options.system ?? DEFAULT_SYSTEM_PROMPT;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  const history = await store.load(session.id);
  const { prompt, dropped } = fitToBudget(system, history, message, maxTokens);

  logger.debug(
    {
      session: session.id,
      provider: session.provider,
      model: session.model,
      turns: history.length,
      dropped,
    },
    'agent turn',
  );
  const response = await getResponse(session.provider, session.model, prompt, 'API');
  await store.append(session.id, { message, response });
  logger.debug({ session: session.id }, 'agent turn complete');
  return response;
}

export { DEFAULT_MAX_TOKENS, type GetResponse, start, type StartOptions };
