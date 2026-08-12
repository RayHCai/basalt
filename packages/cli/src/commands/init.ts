import type { CliContext } from '../context.js';

/**
 * Handle `basalt init` — set up the Basalt state directory.
 *
 * Calls `@basalt/config`'s `initConfig` DIRECTLY (config owns this; it does not
 * route through the agent runtime). Reports the STATE_DIR root and its `agent/`,
 * `config/`, and `secrets/` children, whether it seeded a fresh config or found
 * an existing one, plus a count of the sections present.
 */
async function runInit(ctx: CliContext): Promise<void> {
  ctx.stdout(ctx.palette.bold('Initializing Basalt…'));
  const result = await ctx.initConfig();

  ctx.stdout(`  State directory: ${result.stateDir}`);
  ctx.stdout(
    result.seeded
      ? `  Created config    ${result.configDir}`
      : ctx.palette.dim(`  Using config      ${result.configDir}`),
  );
  ctx.stdout(ctx.palette.dim(`  Secrets           ${result.secretsDir}`));
  ctx.stdout(ctx.palette.dim(`  Agent code        ${result.agentDir}`));

  const providerCount = result.modelProviders.length;
  const pluginCount = result.plugins.length;
  ctx.stdout(
    ctx.palette.dim(
      `  ${providerCount.toString()} model provider(s), ${pluginCount.toString()} plugin(s) configured`,
    ),
  );

  ctx.stdout(ctx.palette.green('Basalt is ready.'));
}

export { runInit };
