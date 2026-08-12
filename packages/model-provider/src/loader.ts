import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { agentModelProvidersDir, getConfig } from '@basalt/config';
import type { ConfigStore, Env } from '@basalt/config';

import { contextFromConfig } from './from-config.js';
import type { ProviderContext } from './context.js';
import { ProviderLoadError } from './errors.js';
import type { ModelProvider } from './provider.js';
import type { CustomHarnessOptions, ModelResponse, ResponseAuthType } from './types.js';

/**
 * Turn a provider NAME into a callable implementation and get a response — the
 * whole public surface a caller needs. Instead of importing and instantiating a
 * concrete provider class, a caller names the provider and the loader resolves
 * it:
 *
 * ```ts
 * import { getResponse } from '@basalt/model-provider';
 *
 * const text = await getResponse('anthropic', 'claude-opus-4-8', input, 'API');
 * ```
 *
 * The name → implementation resolution is config-driven and lazy:
 *   1. Read the provider's config from the (shared) `@basalt/config` store — it
 *      carries the `source` path (installed under
 *      `<STATE_DIR>/agent/model-providers`) alongside the auth/models settings.
 *   2. Dynamic-`import()` that module and take its default export — expected to
 *      be a `BaseModelProvider` subclass constructor.
 *   3. Build the provider's {@link ProviderContext} via {@link contextFromConfig}
 *      and construct the implementation with it.
 *   4. Delegate to the constructed provider's `getResponse` / `getHarnessResponse`.
 *
 * Every step that can fail on installed, hand-configured code is guarded and
 * surfaced as a {@link ProviderLoadError} with the provider name and (when the
 * failure came from imported code) the underlying `cause`. This is a RUNTIME
 * correctness check — the module path exists, the export is constructible, and
 * the constructed value has the expected methods — not a compile-time guarantee.
 */

/** A minimal ESM namespace: whatever `import()` resolves to. */
type ImportedModule = Readonly<Record<string, unknown>>;

/** How the loader turns a module specifier into its namespace. Injectable for tests. */
type ModuleImporter = (specifier: string) => Promise<ImportedModule>;

/** Shared knobs for the loader entry points. All optional; sensible defaults. */
interface LoadOptions {
  /**
   * Config store to resolve the provider from. Defaults to the shared store
   * (`getConfig()`), which must already be configured at startup.
   */
  store?: ConfigStore;
  /** Environment map used to resolve a relative `source` path. Defaults to `process.env`. */
  env?: Env;
  /** How to import the provider's source module. Defaults to a native dynamic `import()`. */
  importModule?: ModuleImporter;
}

/** A constructor that takes a {@link ProviderContext} and yields a provider. */
type ProviderConstructor = new (context: ProviderContext) => unknown;

/** The native dynamic-import importer used when a caller supplies none. */
const nativeImporter: ModuleImporter = (specifier) => import(specifier) as Promise<ImportedModule>;

/**
 * Resolve a provider's `source` field to an absolute module specifier.
 * An absolute path is used as-is; a relative one is resolved against
 * `<STATE_DIR>/agent/model-providers` (where `basalt init` installs provider
 * code). The result is a `file://` URL string so `import()` treats it as a path,
 * not a bare package specifier.
 */
function resolveSourceSpecifier(source: string, env: Env): string {
  const absolute = isAbsolute(source) ? source : resolve(agentModelProvidersDir(env), source);
  return pathToFileURL(absolute).href;
}

/**
 * Construct `Ctor` with `context`, wrapping anything it throws as a
 * {@link ProviderLoadError} so a broken implementation surfaces as a load
 * failure (with the original as `cause`) rather than an opaque throw.
 */
function construct(Ctor: ProviderConstructor, context: ProviderContext, name: string): unknown {
  try {
    return new Ctor(context);
  } catch (error) {
    throw new ProviderLoadError(name, 'its implementation threw while being constructed', {
      cause: error,
    });
  }
}

/** Type guard: the constructed value looks like a {@link ModelProvider}. */
function isModelProvider(value: unknown): value is ModelProvider {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { getResponse?: unknown }).getResponse === 'function'
  );
}

/**
 * Load and construct the implementation backing `name`. Performs the runtime
 * correctness checks (config present, `source` set, module importable,
 * default export constructible, constructed value has the contract methods) and
 * throws {@link ProviderLoadError} on the first that fails.
 */
async function loadProvider(name: string, options: LoadOptions = {}): Promise<ModelProvider> {
  const store = options.store ?? getConfig();
  const env = options.env ?? process.env;
  const importModule = options.importModule ?? nativeImporter;

  const config = store.modelProvider(name);
  if (config === undefined) {
    throw new ProviderLoadError(name, 'no such model provider is configured');
  }
  const { source } = config;
  if (source === undefined) {
    throw new ProviderLoadError(name, 'its config declares no "source" path');
  }

  const specifier = resolveSourceSpecifier(source, env);

  const namespace = await importModule(specifier).catch((error: unknown) => {
    throw new ProviderLoadError(name, `its source at ${specifier} could not be imported`, {
      cause: error,
    });
  });

  const Exported = namespace['default'];
  if (typeof Exported !== 'function') {
    throw new ProviderLoadError(
      name,
      `its source at ${specifier} has no constructable default export`,
    );
  }

  const context = contextFromConfig(store, name);
  const instance = construct(Exported as ProviderConstructor, context, name);

  if (!isModelProvider(instance)) {
    throw new ProviderLoadError(
      name,
      'its implementation does not satisfy the ModelProvider contract (missing getResponse)',
    );
  }
  return instance;
}

/**
 * Get a model response from a named provider, resolving and constructing its
 * implementation on demand. `type` selects the configured auth method (`'API'`
 * or `'oAuth'`). Rejects with {@link ProviderLoadError} if the provider cannot
 * be loaded, or with whatever the implementation raises (e.g.
 * {@link UnsupportedAuthMethodError} if it wasn't configured for `type`).
 *
 * TODO(stream): add a streaming counterpart once {@link ModelResponse} widens.
 */
async function getResponse(
  provider: string,
  model: string,
  input: string,
  type: ResponseAuthType,
  options?: LoadOptions,
): Promise<ModelResponse> {
  const impl = await loadProvider(provider, options);
  return impl.getResponse(model, input, type);
}

/**
 * Drive a named provider's full 3rd-party harness (e.g. `codex`, `claude`) and
 * return its response. Rejects with {@link ProviderLoadError} if the provider
 * cannot be loaded or its implementation exposes no `getHarnessResponse`.
 *
 * TODO(stream): add a streaming counterpart once {@link ModelResponse} widens.
 */
async function getHarnessResponse(
  provider: string,
  input: string,
  harnessOptions?: CustomHarnessOptions,
  options?: LoadOptions,
): Promise<ModelResponse> {
  const impl = await loadProvider(provider, options);
  if (typeof impl.getHarnessResponse !== 'function') {
    throw new ProviderLoadError(provider, 'its implementation exposes no getHarnessResponse');
  }
  return impl.getHarnessResponse(input, harnessOptions);
}

export {
  getHarnessResponse,
  getResponse,
  type LoadOptions,
  loadProvider,
  type ModuleImporter,
  resolveSourceSpecifier,
};
