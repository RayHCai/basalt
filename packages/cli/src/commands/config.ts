import { isValidName } from '@basalt/config';
import type { CreatableKind } from '@basalt/config';

import type { CliContext } from '../context.js';
import { UsageError } from '../errors.js';

/**
 * Handle `basalt config create-<kind> <name>` — seed a per-name config section
 * (model provider / plugin / tool / MCP server) from its base template and print
 * the file path so the user can edit the rest by hand.
 *
 * Calls `@basalt/config`'s `createConfigSection` DIRECTLY (config owns this; it
 * does not route through the agent runtime). Idempotent: an existing section is
 * left untouched and its path reported.
 *
 * The name is checked here first so a bad one is a terse usage error (exit 2)
 * rather than the raw `TypeError` config would otherwise throw — which `run.ts`
 * renders as an unexpected crash.
 */
async function runConfigCreate(ctx: CliContext, kind: CreatableKind, name: string): Promise<void> {
  if (!isValidName(name)) {
    throw new UsageError(
      `Invalid ${kind} name "${name}": use lowercase letters, digits and hyphens, ` +
        `starting with a letter or digit.`,
    );
  }
  const result = await ctx.createConfigSection(kind, name);
  ctx.stdout(`Created ${result.kind} "${result.name}"`);
  ctx.stdout(result.path);
  ctx.stdout(ctx.palette.dim('Edit the file above to finish configuring it.'));
}

export { runConfigCreate };
