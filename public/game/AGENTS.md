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
- Hand-trigger prompts use `triggerText` as display copy; do not infer gameplay from that text.
- Pending local action previews are client-side only and must clear when `pendingActions` no longer contain the local submission.
- Board tokens shown during playback are derived from beats/interactions, not from whatever happens to be in current public state.
- Throw, discard, and passive-modifier parity should come from shared registries, not local allow lists.
