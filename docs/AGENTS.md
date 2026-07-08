# AGENTS

Guidance for AI agents working in this repository.

When adding new code, write the tests first, then add the logic.

## Project layout

Every workspace member is a package under `packages/*`. Dependencies flow one
direction (leaf → root):

    cli → runtime → session-router → sandbox → agent
                        |               |          |
                        +→ storage      +→ config  +→ config → secrets
                                                    +→ observability

See the [root README](../README.md) for the full package descriptions and the
runtime state-directory (`STATE_DIR`) layout.
