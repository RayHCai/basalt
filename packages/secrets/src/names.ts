/**
 * Allowed secret-name shape: lowercase alphanumerics and hyphens, starting with
 * an alphanumeric. This is a strict allowlist (not a denylist of bad chars) so
 * path traversal (`..`, `/`, `\`, NUL) and casing surprises are impossible by
 * construction — the same guard `@basalt/config` applies to config section
 * names, since secret names are ultimately keys in a JSON map and labels a
 * human reads in listings.
 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

/** Longest permitted secret name, to bound listing/JSON size. */
const MAX_NAME_LENGTH = 128;

/**
 * Validate a secret name, throwing a descriptive error on any violation.
 * Returns the name unchanged so it can be used inline.
 */
function assertValidName(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('Secret name must be a non-empty string');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new RangeError(`Secret name exceeds ${MAX_NAME_LENGTH} characters`);
  }
  if (!NAME_PATTERN.test(name)) {
    throw new TypeError(
      `Invalid secret name "${name}": use lowercase letters, digits and hyphens, ` +
        `starting with a letter or digit.`,
    );
  }
  return name;
}

/** Non-throwing predicate form of {@link assertValidName}. */
function isValidName(name: unknown): name is string {
  return typeof name === 'string' && name.length <= MAX_NAME_LENGTH && NAME_PATTERN.test(name);
}

export { assertValidName, isValidName, MAX_NAME_LENGTH };
