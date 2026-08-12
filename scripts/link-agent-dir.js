/**
 * Make `<STATE_DIR>/agent/` a place where installed agent code (raw `.ts`
 * providers/tools) can `import` workspace packages like `@basalt/model-provider`
 * — both at runtime (`import()`) and for type-checking (`tsc`).
 *
 * Installed code lives OUTSIDE the pnpm workspace, so Node/tsc can't resolve
 * `@basalt/*` from there by default. This script drops a `node_modules/@basalt/*`
 * symlink tree into the agent dir pointing back at each workspace package, plus
 * a `tsconfig.json` so the files type-check against the real contracts.
 *
 * The symlinks point at package DIRECTORIES (not their `dist/`), so they never
 * go stale when a package rebuilds — this script only needs to CREATE them once
 * per fresh state dir. It is fully idempotent: existing, correct links and the
 * tsconfig are left as-is. Run after build (see root `build` script) and safe to
 * run anytime.
 *
 * Honors `BASALT_STATE_DIR`; defaults to `<repo>/.basalt`, matching config's
 * state-dir resolution.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Resolve the state dir the same way `@basalt/config` does. */
function stateDir() {
  const override = process.env['BASALT_STATE_DIR'];
  if (typeof override === 'string' && override.length > 0) {
    return resolve(override);
  }
  return join(repoRoot, '.basalt');
}

/** All `@basalt/*` workspace packages under `packages/` (one level, plus `packages/runtime/*`). */
function workspacePackages() {
  const roots = [join(repoRoot, 'packages')];
  const pkgs = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      const manifest = join(dir, 'package.json');
      if (!existsSync(manifest)) continue;
      const name = JSON.parse(readFileSync(manifest, 'utf8')).name;
      if (typeof name === 'string' && name.startsWith('@basalt/')) {
        pkgs.push({ name, dir });
      }
    }
  }
  return pkgs;
}

/** Create (or fix) a symlink at `linkPath` pointing to `target`. Idempotent. */
function ensureSymlink(linkPath, target) {
  if (existsSync(linkPath)) {
    try {
      const current = readlinkSync(linkPath);
      const resolved = resolve(dirname(linkPath), current);
      if (resolved === target) return; // already correct
    } catch {
      // not a symlink — replace it
    }
    rmSync(linkPath, { recursive: true, force: true });
  }
  mkdirSync(dirname(linkPath), { recursive: true });
  symlinkSync(target, linkPath, 'dir');
}

function main() {
  const agentDir = join(stateDir(), 'agent');
  if (!existsSync(agentDir)) {
    // No state dir yet — nothing to link. `basalt init` creates the agent tree.
    return;
  }

  const nodeModulesBasalt = join(agentDir, 'node_modules', '@basalt');
  for (const { name, dir } of workspacePackages()) {
    const short = name.slice('@basalt/'.length);
    ensureSymlink(join(nodeModulesBasalt, short), dir);
  }

  // Drop a tsconfig so installed `.ts` type-checks against the real contracts.
  const tsconfigPath = join(agentDir, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) {
    const baseRel = relative(agentDir, join(repoRoot, 'tsconfig.base.json'));
    const tsconfig = {
      extends: baseRel,
      compilerOptions: { types: ['node'], noEmit: true, isolatedDeclarations: false },
      include: ['model-providers/**/*.ts', 'tools/**/*.ts'],
    };
    writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + '\n');
  }
}

main();
