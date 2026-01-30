# Card Text Abstractions

## Action-symbol anchors
- `{i}`: bracketed action token(s) in the action list (e.g., `[m]`, `[2a]`). Effects that reference `{i}` should target the bracketed action index.
- In code: `getSymbolActionIndices` in `src/game/cardText/activeMovement.ts` and `public/game/cardText/activeMovement.js`.

## Rotation injections
- `rotationSource` marks where a rotation comes from:
  - `selected`: player-selected rotation (start of action set).
  - `forced`: card-text rotation applied at a symbol anchor (for example, `{i}`).
- Consumers that need the start of an action set (timeline tooltips) should prefer `rotationSource === 'selected'`, falling back to non-empty `rotation` when missing (legacy data).

## Conditional throw + charge
- `cardStartTerrain` is stamped on beat entries during execution to capture the terrain at the start of the action set.
- Grappling Hook: the `{i}` (bracketed) charge step stops at the first land tile or target in front, and its throw interaction only applies when `cardStartTerrain === 'land'`.

## Passive movement effects
- Fleche passive: remove the final `{W}` from the active ability action list when an attack token appears before it.
- Ninja Roll passive: only `{a}` (or `[a]`) becomes `{a-La-Ra}`; other attack tokens are unchanged. Halve damage/KBF (rounded down) on the affected step.
- Grappling Hook passive: when an `{a}` lands, flip the target to the opposite side of the attacker and knock them further in that direction (execution + playback).
- In code: Fleche/Ninja Roll are in `applyPassiveMovementCardText` (`src/game/cardText/passiveMovement.ts` and `public/game/cardText/passiveMovement.js`); Grappling Hook passive is handled in `src/game/execute.ts` + `public/game/timelinePlayback.js`.

## Action list transforms
- Card text that modifies the action list (add/remove/replace) should use the shared helpers in
  `src/game/cardText/actionListTransforms.ts` and `public/game/cardText/actionListTransforms.js` to keep behavior precise and mirrored.
