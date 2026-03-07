# Client Playback Guide

## Purpose

`public/game` owns rendering, animation, input handling, and prompt UI. It should consume shared generated rule helpers instead of reimplementing server logic.

## Shared-Core Rule Imports

- Prefer the existing wrappers in `public/game/cardText/*`, `public/game/beatTimeline.js`, and `public/shared/timing.js`.
- Those wrappers now forward to `public/generated/shared/game/*`.
- If the browser needs a new pure rule helper, add it in `src/shared/game` and let the build emit it instead of copying JS into `public/game`.

## UI/Playback Boundaries

- `timelinePlayback.js` should stay focused on playback state and animation timing, not its own rule fork.
- `renderer.js` should stay draw-only where practical.
- Prompt selection logic belongs in the dedicated prompt/interaction modules, not renderer code.

## High-Value Gotchas

- The action HUD only unlocks at the earliest open beat when the local player is actually at bat.
- Timeline stop points include pending interactions such as throw, discard, hand-trigger, draw, haven-platform, guard-continue, rewind-return, and draw-offer.
- Tooltip and rulebook copy must use icons, not raw action token text.
- WARNING: never ship player-facing tooltip/rulebook copy that spells out token codes like `2m`, `Bb`, `a-La-Ra`, `SigE`, `X1`, or timing codes when those symbols have icon assets.
- Card-hover symbol tooltip text comes from `src/shared/game/symbolTooltips.ts` via `public/shared/cardSymbolTooltips.js`; when new visible symbols are added, update that registry instead of hard-coding one-off explanations in UI modules.
- Hand-trigger prompts use `triggerText` as display copy; do not infer gameplay from that text.
- Tutorial prompt gating should validate only inputs that materially affect the scripted outcome; the final tutorial Smash Attack intentionally allows any submitted adrenaline.
- Pending local action previews are client-side only and must clear when `pendingActions` no longer contain the local submission.
- Board tokens shown during playback are derived from beats/interactions, not from whatever happens to be in current public state.
- Throw, discard, and passive-modifier parity should come from shared registries, not local allow lists.
- Same-timing movement playback must mirror server-simultaneous vacates. Do not let ordered occupancy updates make a mover bounce off a hex that another successful tied mover leaves that same bucket.
- Flora/fire placement priority and Druidic Presence committed-rotation targeting should come from shared board-token helpers, not copied playback-local switches.
- Play-modal beat pointers must follow `actionSetStep` from the resolved beat entry, not raw `beatIndex - startIndex`, because Guard loops, rewind-style returns, and other timeline rewrites can revisit earlier card steps without changing gameplay.
