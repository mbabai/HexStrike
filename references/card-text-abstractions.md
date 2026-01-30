# Card Text Abstractions

## Action-symbol anchors
- `{i}`: bracketed action token(s) in the action list (e.g., `[m]`, `[2a]`). Effects that reference `{i}` should target the bracketed action index.
- In code: `getSymbolActionIndices` in `src/game/cardText/activeMovement.ts` and `public/game/cardText/activeMovement.js`.

## Rotation injections
- `rotationSource` marks where a rotation comes from:
  - `selected`: player-selected rotation (start of action set).
  - `forced`: card-text rotation applied at a symbol anchor (for example, `{i}`).
- Consumers that need the start of an action set (timeline tooltips) should prefer `rotationSource === 'selected'`, falling back to non-empty `rotation` when missing (legacy data).
