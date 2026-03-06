# Server Rules Guide

## Purpose

`src/game` owns authoritative server resolution, submission validation, and server-only orchestration. Pure logic that the browser also needs should live in `src/shared/game` first, then be imported here.

## Architecture Boundaries

- Keep `execute.ts` as orchestration glue around smaller helpers and shared registries.
- Do not copy pure helpers into `src/game` if the browser also needs them.
- Shared browser output is generated from `src/shared/game` into `public/generated/shared/game`.

## Shared Registries

Use these as the first stop for recurring card families:
- `src/shared/game/throwSpecs.ts`
- `src/shared/game/preActionSpecs.ts`
- `src/shared/game/handTriggers.ts`
- `src/shared/game/cardText/passiveModifierSpecs.ts`
- `src/shared/game/cardText/discardSpecs.ts`

## High-Value Gotchas

- Submitted adrenaline spends at the selected-rotation commit point, even if the start action is immediately interrupted.
- `rotationSource: 'selected'` and `comboStarter` mark protected future starts. Replay/hit/rewind mutators must not erase them.
- `F` is open for insertion and turn gating, but not a free refresh beat.
- Same-beat `DamageIcon` frames still count as active for Iron Will, Vengeance, Spike, Sweeping Strike, and Hammer-style hit-reactive logic.
- Hip Throw and Tackle throw immunity do not remain active on `DamageIcon`.
- Grappling Hook is part of the throw family, but its throw remains conditional on land-start plus adjacent target during the bracketed charge.
- `triggerText` never drives gameplay.
- Ability cards never exhaust. Movement cards do.
- Refresh must key off the earliest open beat on land plus `lastRefreshIndex`, not the client-visible beat.
- Board token replay must be reconstructed from timeline state, not future `public.boardTokens`.

## Required Updates When Mechanics Change

- Update tests first or alongside the change.
- Update `rules.md` for exact behavior changes.
- Update `references/card-text-abstractions.md` when a wording family or registry changes.
