import { isValidName } from '@basalt/config';

import type { CliContext } from '../context.js';
import { UsageError } from '../errors.js';

/**
 * Handle `basalt secret set <secret_name>` — seal a secret, encrypted at rest
 * under `<STATE_DIR>/secrets`, so config markers `{ "$secret": "<name>" }`
 * resolve to it (the sealing/derived-name detail lives in `@basalt/config`'s
 * `setSecret`, reached through the injected context).
 *
 * SECURITY: the value is NEVER a command-line argument — an argv value leaks to
 * shell history, the process table (`ps`), and any command logging. It is read
 * from one of two safe sources instead:
 *   - **piped stdin** — `basalt secret set NAME < token.txt` (the scriptable path);
 *   - **an interactive no-echo prompt** — when stdin is a TTY, the value is typed
 *     but not echoed.
 * This mirrors `docker login --password-stdin`, `gh auth login`, and
 * `git credential`.
 *
 * The name is validated here first so a bad one is a terse usage error (exit 2)
 * rather than a deeper throw from the store.
 */
async function runSecretSet(ctx: CliContext, name: string): Promise<void> {
  if (!isValidName(name)) {
    throw new UsageError(
      `Invalid secret name "${name}": use lowercase letters, digits and hyphens, ` +
        `starting with a letter or digit.`,
    );
  }

  const value = await ctx.readSecretValue(`Value for "${name}": `);
  if (value.length === 0) {
    throw new UsageError(
      `No value provided for "${name}". Pipe it on stdin ` +
        `(basalt secret set ${name} < file) or type it at the prompt.`,
    );
  }

  await ctx.setSecret(name, value);
  ctx.stdout(`Set secret "${name}" (${ctx.palette.dim('[redacted]')}, ${value.length} chars)`);
}

export { runSecretSet };
