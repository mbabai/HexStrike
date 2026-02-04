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

## Action icon assets
- Any new action token label (ex: `2c`, `B2m`, `B3j`) must have a matching PNG in `public/images/{token}.png` or the HUD/icon renderer will show the empty fallback.
- Generate missing icons with `scripts/hex_diagrams_creator.py` (default output is `public/images`).

## Discard interactions
- Discard effects queue a `customInteractions` entry of type `discard` with `discardCount`; the UI pauses on that beat and prompts the affected player to discard.
- Discard selection follows hand-size rules: discard X ability cards, then discard movement cards to match the post-discard target size (see `getDiscardRequirements` in `src/game/handRules.ts`).
- Spike passive grants discard immunity to opponent-driven discard effects while the action set is active.
- Trip passive converts knockback distance into discard count (no knockback movement) but still uses the pre-conversion distance for stun checks.
- Server mapping: `src/game/cardText/discardEffects.ts`; client mirror: `public/game/cardText/discardEffects.js`.

## Hand-trigger interactions (in-hand reveals)
- Cards with "If X is in your hand..." create a `customInteractions` entry of type `hand-trigger` when the trigger fires and the card is still in hand.
- Interaction fields: `cardId`, `cardType`, `effect`, optional `sourceUserId`, and payloads like `attackHexes` (Burning Strike) or `drawCount` (Vengeance).
- Resolution: `/api/v1/game/interaction` with `{ use, movementCardIds, abilityCardIds }`; discard requirements follow `getDiscardRequirements` in `src/game/handRules.ts`.
- UI prompt: `public/index.html` + `public/game/handTriggerPrompt.mjs` (green reveal glow on the trigger card, red discard glow on required extra cards).
- Timeline: mini card marker is drawn between beats in `public/game/timeIndicatorView.js`; tooltip uses `public/game/timelineTooltip.js` + `public/game/handTriggerText.mjs`.

## Board tokens
- `boardTokens` live in `public.boardTokens` with types `fire-hex` and `arrow`.
- Fire hex: persistent; deals 1 damage per beat to any character standing on the hex.
- Arrow: advances 1 hex per beat (charge), deals 4 damage with KBF 1 on hit, and is removed on hit or when its distance to land is ≥ 5.
- Rendering: tokens are drawn like character portraits (circle + facing triangle) with a black border in `public/game/renderer.js`.
