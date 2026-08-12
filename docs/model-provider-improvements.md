# Model-provider: future improvements

Notes on known limitations of `@basalt/model-provider` and the performance work
we want to do. Nothing here is a bug — it all works — but the loader trades
per-call efficiency for simplicity today.

## Current behavior

`getResponse(provider, model, input, type)` resolves a provider by name on every
call (see `loader.ts`): read config → resolve the `implementation` path →
`import()` the module → build a `ProviderContext` → `new Ctor(context)` → delegate.

The module itself is cached — Node's ESM registry evaluates a given `file://`
specifier once and returns the same namespace on later imports (and there is no
API to unload it). So the file is not re-read or re-parsed per call.

## Issues

- **New instance every call.** We construct a fresh provider on each request, so
  nothing survives between calls: no HTTP keep-alive/connection pool, no cached
  OAuth token (an OAuth provider re-exchanges every request), and the impl
  constructor (arbitrary code) re-runs each time.
- **Redundant per-call work.** `contextFromConfig` rebuilds the credentials bag +
  models array and creates a new scoped logger every call; secret markers are
  re-resolved into fresh `Secret` boxes.

## Wanted improvements

- **Memoize constructed instances.** Cache `Map<name, ModelProvider>` (or
  `Map<name, Promise<ModelProvider>>` to dedupe concurrent first-loads).
  Construct on miss, reuse after — module is already cached; this also caches the
  context build.
- **Cache invalidation.** Config is mutable at runtime, so a per-name cache goes
  stale after an edit. Add `resetProvider(name)` / `resetProviders()` (mirroring
  config's `resetConfig()`), called when a provider's config changes.
- **Keep-alive / pooling.** Once instances persist, let a provider hold a shared
  HTTP agent / connection pool and cache OAuth access tokens across calls.
- **Preload option.** Consider eagerly loading + constructing all enabled
  providers at startup, so the first real request pays no load cost.
