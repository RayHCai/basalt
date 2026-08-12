/**
 * Allowed config-section name shape: lowercase alphanumerics and hyphens,
 * starting with an alphanumeric. A strict allowlist (not a denylist of bad
 * chars) so path traversal (`..`, `/`, `\`, NUL) and casing surprises are
 * impossible by construction — section names become file names under
 * `config/model-providers/` and `config/plugins/`, and keys in listings.
 *
 * This deliberately matches the guard `@basalt/secrets` applies to secret names
 * (the two namespaces are kept in lockstep), and the pattern is validated once
 * here before any name reaches the filesystem.
 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

/** Longest permitted section name, to bound file/listing/JSON size. */
const MAX_NAME_LENGTH = 128;

/** Non-throwing predicate: `true` only for a valid section name. */
function isValidName(name: unknown): name is string {
  return typeof name === 'string' && name.length <= MAX_NAME_LENGTH && NAME_PATTERN.test(name);
}

/**
 * Validate a config section name (model-provider / plugin), throwing a
 * descriptive error on any violation. Returns the name unchanged so it can be
 * used inline: `const file = modelProviderFile(assertValidName(name))`.
 */
function assertValidName(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('Config section name must be a non-empty string');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new RangeError(`Config section name exceeds ${MAX_NAME_LENGTH} characters`);
  }
  if (!NAME_PATTERN.test(name)) {
    throw new TypeError(
      `Invalid config section name "${name}": use lowercase letters, digits and ` +
        `hyphens, starting with a letter or digit.`,
    );
  }
  return name;
}

export { assertValidName, isValidName, MAX_NAME_LENGTH };
