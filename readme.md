This project will be a monorepo:

- pnpm + Turborepo
- strong oxlint rules
- strong tsconfig typing rules for modern, best practice typescript
- consistent formatting with prettier
- pnpm package overrides + minimumReleaseAge + allowBuilds allowlist
- pre-commit hooks for lints
- github actions for lints, typecheck, build. knip for dead deps.
- checks for import cycles
- primarily typescript package
- keep package dependencies clean with good hygiene
- pin to node 24

Folder structure:

.github/
pre-commit/
docs/

.config/

agent-tooling/
... all of the information available to an agent during runtime
scripts/
skill-files/
tools/
mcps/

plugins/
... external plugins that can be added via a centralized plugin interface.
... each plugin will have it's own folder

channels/
... each channel will have it's own folder

apps/
dashboard/
backend/
mobile/
desktop/

models/
... each model connection will be defined in it's own folder
... it will be contracted by the model SDK

package/
public/
plugin-sdk/
channel-sdk/
model-sdk/
gateway-connection-protocol/
... central types/schemas for how a loop will receive a task
... also how servers will respond, expect, etc
internal/
config/
... general accessors
security/
... server auth, wrappers/helpers to handle prompt injection, secret handling, etc
cli/
... general CLI classes and helpers + CLI base tool

src/
tests/
... integration tests
evals/
benchmarks/
data/
agent/
lifecycle/
router/
harness/
assembler/
tool-handler/
mcp-handler/
skill-handler/
sandbox/
memory/
gateway/
triggers/
cron/
user/
event-hook/
server/
connections/
observability/
... logs, etc
usage/
