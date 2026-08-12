/**
 * The framework-side view of the models a provider offers.
 *
 * `@basalt/config` stores a provider's models as `{ name, enabled }` entries;
 * this is the shape an implementation actually sees on its {@link ProviderContext}.
 * It is deliberately decoupled from the config type (as {@link ProviderCredentials}
 * is from the config's `auth`) so config can grow per-model fields without
 * reshaping the provider contract.
 */

/** One model a provider offers, as seen by an implementation. */
interface ModelInfo {
  /** The model identifier a caller passes to `getResponse` (e.g. `claude-opus-4-8`). */
  readonly name: string;
  /** Whether the model is currently active. A provider's "active models" are these. */
  readonly enabled: boolean;
}

/** The subset of `models` that are currently active (`enabled: true`). */
function activeModels(models: readonly ModelInfo[]): readonly ModelInfo[] {
  return models.filter((model) => model.enabled);
}

export { activeModels, type ModelInfo };
