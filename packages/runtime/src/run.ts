import { DEFAULT_SESSION, start as loopStart } from '@basalt/agent';
import type { Session } from '@basalt/agent';
import { configureConfig as configureConfigDefault } from '@basalt/config';

/**
 * `@basalt/runtime` — what `basalt` actually invokes to RUN THE AGENT.
 *
 * The runtime is the composition root of the agent stack
 * (`cli → runtime → session-router → agent-workspace → agent`): it wires config,
 * storage, and the agent loop together and owns startup. Its job is running
 * basalt — NOT the read-only/管理 subcommands. Inspecting sessions and cron,
 * and initializing config, are owned by their packages (`@basalt/storage`,
 * `@basalt/config`) and the CLI calls those directly; they do not pass through
 * here.
 *
 * The lower layers are still being built, so this is a THIN first cut: the one
 * agent operation configures the shared config store (so the model-provider
 * loader can resolve providers by name), then runs a single turn of the agent
 * loop (`@basalt/agent`) against the {@link DEFAULT_SESSION} and returns the
 * reply. That session exercises the API path against the `anthropic` provider's
 * `claude-haiku-4-5`, so a real reply requires the provider configured and its
 * API key set (`basalt secret set anthropic-api-key`).
 */

/** Send a message/task to the agent (the bare `basalt <message>` command). */
interface SendMessageRequest {
  kind: 'sendMessage';
  message: string;
  /** The resolved primary session to run against. Takes priority over `RunOptions.session`. */
  session?: Session;
}

/**
 * Every operation the runtime can be asked to perform. A discriminated union so
 * the agent surface can grow (resume a session, run a cron-triggered task, …)
 * without changing the `run` signature; today it carries just the one member.
 */
type RuntimeRequest = SendMessageRequest;

/** Discriminant of a {@link RuntimeRequest}. */
type RuntimeRequestKind = RuntimeRequest['kind'];

/** The result produced for a given request kind. */
interface RuntimeResultMap {
  /** The agent's reply to the message. */
  sendMessage: string;
}

/** The result type for a specific request `R`. */
type RuntimeResult<R extends RuntimeRequest> = RuntimeResultMap[R['kind']];

/**
 * Wiring seams for {@link run}, all optional. They exist so a test can drive the
 * runtime without touching the real config store on disk or a configured
 * provider; production omits them and gets the defaults.
 */
interface RunOptions {
  /**
   * Configure the shared config store (the composition-root step the loader
   * relies on). Defaults to `@basalt/config`'s `configureConfig`.
   */
  configureConfig?: () => Promise<unknown>;
  /** Run one agent-loop turn. Defaults to `@basalt/agent`'s `start`. */
  start?: (session: Session, message: string) => Promise<string>;
  /** The session a turn runs against. Defaults to the {@link DEFAULT_SESSION}. */
  session?: Session;
}

/**
 * The single runtime entry point. Dispatches a {@link RuntimeRequest} to its
 * handler and resolves to the corresponding {@link RuntimeResultMap} value. The
 * overload keeps the return type precise per request kind at the call site.
 */
async function run<R extends RuntimeRequest>(
  request: R,
  options?: RunOptions,
): Promise<RuntimeResult<R>>;
// oxlint-disable-next-line require-await -- async is required by the return type; the branches return promises directly
async function run(
  request: RuntimeRequest,
  options: RunOptions = {},
): Promise<RuntimeResultMap[RuntimeRequestKind]> {
  switch (request.kind) {
    case 'sendMessage': {
      return sendMessage(request, options);
    }
    default: {
      // Exhaustiveness guard: a new request kind must be handled above.
      return assertNever(request.kind);
    }
  }
}

/**
 * Handle a `sendMessage` request: ensure config is loaded (so the model-provider
 * loader can resolve a provider by name), then run one agent-loop turn against
 * the session and return its reply.
 */
async function sendMessage(request: SendMessageRequest, options: RunOptions): Promise<string> {
  const configure = options.configureConfig ?? configureConfigDefault;
  const start = options.start ?? loopStart;
  const session = request.session ?? options.session ?? DEFAULT_SESSION;

  await configure();
  return start(session, request.message);
}

/** Compile-time exhaustiveness check for the request-kind switch. */
function assertNever(value: never): never {
  throw new Error(`Unhandled runtime request: ${JSON.stringify(value)}`);
}

export {
  run,
  type RunOptions,
  type RuntimeRequest,
  type RuntimeRequestKind,
  type RuntimeResult,
  type RuntimeResultMap,
  type SendMessageRequest,
};
