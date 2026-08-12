import { DEFAULT_SESSION, start as agentStart } from '@basalt/agent';
import type { Session } from '@basalt/agent';
import { configureConfig as configureConfigDefault } from '@basalt/config';

import type { Attempt } from './instrument.js';

/**
 * The eval RUNTIME — the isolated harness a run executes in.
 *
 * The eval pipeline does not reuse `@basalt/runtime`'s `run()`: that entry point
 * fixes the session to the `anthropic` `DEFAULT_SESSION` and is shaped for a
 * single interactive turn. Evals instead stand up their OWN runtime object so a
 * run is pinned to a chosen provider/model (the `dummy` provider for this
 * bring-up) and every sample is driven identically, in isolation from the
 * interactive path.
 *
 * The harness mirrors runtime's composition-root shape: it configures the shared
 * config store once (so the model-provider loader can resolve the provider by
 * name), then drives `@basalt/agent`'s `start` per sample. Both steps are
 * injectable so tests exercise the pipeline without a configured provider on
 * disk.
 *
 * IMPORTANT: this bring-up is validated with the `dummy` provider ONLY. The dummy
 * returns a constant string and reports no usage, so it fails every score — the
 * point is to prove the pipeline runs end to end, not to measure a real model.
 */

/** The agent-loop turn the harness drives. Matches `@basalt/agent`'s `start`. */
type StartTurn = (session: Session, message: string) => Promise<string>;

/** Configure the shared config store. Matches `@basalt/config`'s `configureConfig`. */
type ConfigureConfig = () => Promise<unknown>;

/** Options for {@link createHarness}. All optional — process-backed defaults. */
interface HarnessOptions {
  /**
   * The provider NAME the run resolves for every sample. Defaults to `dummy` —
   * the only provider this pipeline is validated against.
   */
  provider?: string;
  /** The model identifier passed to the provider. Defaults to `dummy-model`. */
  model?: string;
  /**
   * Configure the shared config store (composition-root step). Defaults to
   * `@basalt/config`'s `configureConfig`.
   */
  configureConfig?: ConfigureConfig;
  /** Run one agent-loop turn. Defaults to `@basalt/agent`'s `start`. */
  start?: StartTurn;
}

/**
 * A prepared eval runtime: `attempt(input)` drives one agent turn for a sample's
 * prompt and returns the raw {@link Attempt} (output + any reported usage).
 * `configure()` runs the one-time composition-root setup and must be awaited
 * before the first `attempt`.
 */
interface Harness {
  /** The provider name this harness drives. */
  readonly provider: string;
  /** The model this harness drives. */
  readonly model: string;
  /** One-time setup: configure the shared config store. Idempotent-friendly. */
  configure: () => Promise<void>;
  /** Drive one agent turn for `input` and return the raw attempt. */
  attempt: (input: string) => Promise<Attempt>;
}

/** Default provider name — the dummy, the only one this pipeline is validated on. */
const DEFAULT_PROVIDER = 'dummy';

/** Default model name — the dummy provider's single model. */
const DEFAULT_MODEL = 'dummy-model';

/**
 * Build an eval harness pinned to a provider/model. The returned session reuses
 * {@link DEFAULT_SESSION}'s id for log correlation but overrides the provider and
 * model so a run targets the chosen provider (dummy) rather than the interactive
 * default (anthropic).
 *
 * `attempt` returns an {@link Attempt} with no `usage`, because the current
 * `@basalt/agent`/`@basalt/model-provider` surface returns only the response
 * text — instrumentation therefore falls back to its estimates (see
 * `instrument.ts`). When the provider surface widens to report usage, `attempt`
 * populates `usage` and the estimates yield to real counts with no other change.
 */
function createHarness(options: HarnessOptions = {}): Harness {
  const provider = options.provider ?? DEFAULT_PROVIDER;
  const model = options.model ?? DEFAULT_MODEL;
  const configure = options.configureConfig ?? configureConfigDefault;
  const start = options.start ?? agentStart;

  const session: Session = { id: DEFAULT_SESSION.id, provider, model };

  return {
    provider,
    model,
    configure: async (): Promise<void> => {
      await configure();
    },
    attempt: async (input: string): Promise<Attempt> => {
      const output = await start(session, input);
      // The current agent surface returns only text; no usage is available, so
      // instrumentation estimates. See the doc comment above.
      return { output };
    },
  };
}

export {
  type ConfigureConfig,
  createHarness,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  type Harness,
  type HarnessOptions,
  type StartTurn,
};
