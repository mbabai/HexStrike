# Documentation Authority

Use this file as the repo-wide map for which document is authoritative for which kind of truth.

## Exact Mechanics

- `rules.md`: exact implementation-facing rules reference. Update this whenever live mechanics, edge cases, or prototype systems change.
- Tests in `test/`: executable proof of live behavior. If `rules.md` and tests disagree, reconcile them immediately.

## Player Explanation

- `public/rulebook.html`: clarity-first player-facing rulebook. It should teach the game cleanly and stay non-contradictory with `rules.md`, but it may omit engine-level edge cases.

## Architecture and Workflow

- `architecture.md`: runtime topology, server/client flow, and shared-core structure.
- `README.md`: setup, build, run, and operational entry point.
- `references/card-text-abstractions.md`: catalog of wording families, shared registries, and implementation anchors.
- `AGENTS.md` plus subsystem AGENTS files: contributor instructions and high-value gotchas.

## Update Contract

When a gameplay change lands:
1. Update tests.
2. Update `rules.md`.
3. Update `references/card-text-abstractions.md` if the change affects a wording family, registry, or exception.
4. Update `public/rulebook.html` only if player-facing explanation needs to change.
