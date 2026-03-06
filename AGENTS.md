# HexStrike Agent Guide

## Read This First

HexStrike is a server-authoritative living card game prototype on a shared beat timeline. The server resolves rules, the browser renders and animates them, and pure rule logic is now expected to live in the shared TypeScript core under `src/shared/game`.

## Authority Map

- `README.md`: setup and run commands.
- `architecture.md`: runtime structure and shared-core layout.
- `rules.md`: exact implementation coverage.
- `public/rulebook.html`: clarity-first player rulebook.
- `references/card-text-abstractions.md`: wording families, registries, and exception points.
- `docs/documentation-authority.md`: which document owns which kind of truth.

## Shared-Core Rules

- Put browser/server-neutral game logic in `src/shared/game`.
- `src/game/*` and `public/game/*` should import or re-export that shared logic instead of maintaining parallel implementations.
- Browser shared output is generated into `public/generated/shared/game` by `cmd /c npm run build`.

## Global Conventions

- Card data source of truth: `public/cards/cards.json`.
- `triggerText` is display copy only. Hand-trigger gameplay comes from the shared registry.
- Do not show raw symbol codes in player-facing UI/docs when an icon exists.
- Update tests, `rules.md`, and `references/card-text-abstractions.md` in the same change when live mechanics change.
- Use `cmd /c npm run build` and `cmd /c npm test` for validation on this machine.

## Subsystem Guides

- `src/game/AGENTS.md`: server rules, timeline integrity, shared registries, and execution gotchas.
- `public/game/AGENTS.md`: playback/UI boundaries, prompt flow, and rendering-specific gotchas.
- `docs/AGENTS.md`: documentation authority and sync rules.
