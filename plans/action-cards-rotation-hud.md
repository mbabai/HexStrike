# Action Cards + Rotation HUD + Pending Submissions

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `PLANS.md` from the repository root.

## Purpose / Big Picture

Players should choose actions by dragging movement and ability cards into active/passive slots, select a legal rotation from a center-bottom rotation donut, and submit only when all concurrent players at the earliest timeline beat have chosen. This change replaces the old action modal with a card-driven HUD, enforces rotation restrictions per active card, and makes pending players blink red on the timeline until everyone submits. A user can see this working by entering a match, selecting the earliest highlighted beat on the timeline, dragging one movement and one ability card into the slots, selecting a legal rotation, and submitting; if both players are at the same earliest beat, their actions should only appear after both have submitted.

## Progress

- [x] (2025-12-20 20:12) Capture current action UI, rotation wheel, and action-set server flow to identify all touch points for replacement.
- [x] (2025-12-20 20:12) Define the card data JSON and HUD layout, including rotation restrictions and drag/drop slot rules.
- [x] (2025-12-20 20:12) Implement client HUD, rotation wheel updates, and timeline blink, then add server-side pending action batching.
- [ ] Validate behavior in the browser and document any data ambiguities or follow-ups.

## Surprises & Discoveries

- Observation: Immediate action-set application (single at-bat player) requires an optimistic unlock path when no pendingActions envelope is emitted.
  Evidence: Client unlock logic must watch beat index changes instead of waiting solely for pendingActions.

## Decision Log

- Decision: Interpret rotation restrictions like `0-2` as magnitude ranges that allow both left/right steps with matching counts plus numeric `0`/`3`.
  Rationale: Rotation labels are directional but the spec describes numeric ranges, so magnitude mapping preserves intent without introducing new labels.
  Date/Author: 2025-12-20 20:12 (Codex)

- Decision: Defaulted Backflip priority to 25 and Push Kick damage/KBF to 0 pending confirmation.
  Rationale: The source list omitted those values; placeholders keep the JSON complete while awaiting clarification.
  Date/Author: 2025-12-20 20:12 (Codex)

- Decision: Use `pendingActions` in public game state to coordinate pending submissions and timeline blinking.
  Rationale: Clients need a shared, authoritative pending view to blink waiting players and lock/unlock HUDs consistently.
  Date/Author: 2025-12-20 20:12 (Codex)

## Outcomes & Retrospective

Not started.

## Context and Orientation

The current game action UI is defined in `public/index.html` under the `.game-actions` panel and wired in `public/game.js` using hard-coded `actionConfigs`. The rotation donut is built in `public/game/rotationWheel.js` and styled in `public/theme.css` under `.rotation-selector`/`.rotation-wheel`. Timeline portraits and action icons are rendered in `public/game/timeIndicatorView.js`, which is called by `public/game/renderer.js`. Action submissions are sent to `/api/v1/game/action-set` in `public/game.js`, and the server applies them immediately in `src/server.ts` by calling `applyActionSetToBeats` in `src/game/actionSets.ts` and `executeBeats` in `src/game/execute.ts`.

The change introduces a card catalog for movement and ability actions (JSON in `public/game/cards.json`) and a new HUD layout at the bottom center of the game area. The client must only show the HUD when the timeline is set to the earliest `E` across all players and the local player is eligible to act. When multiple players share the earliest `E`, the server must hold action sets until all eligible players submit, then apply them simultaneously and clear the HUD.

## Plan of Work

First, replace the existing `.game-actions` markup in `public/index.html` with a new HUD container that has left/right columns for cards, center slots for active/passive selections, a submit button, and the rotation wheel container. Update `public/theme.css` to style the HUD, card boxes, slots, locked state, and disabled rotations, and reposition the rotation wheel to the bottom center. Update `public/game/rotationWheel.js` to render a center "rotation" label and to support disabling wedges based on the active card’s rotation restriction.

Second, add `public/game/cards.json` with the movement and ability cards specified, and a client helper to load the card catalog and build a player hand with all four movement cards and four random ability cards. Implement drag-and-drop and slot logic in the client so that active/passive slots must be filled with different card types, the active card drives rotation restrictions, and the submit button appears only when both slots are filled and a legal rotation is selected. When submitted, the HUD should visually lock and ignore interaction until the server resolves the batch.

Third, extend the server in `src/server.ts` to batch action sets when more than one player is at the earliest `E`. Track pending submissions per game, broadcast pending state in `game:update`, and apply all action sets together once every eligible player has submitted. Extend `src/types.ts` and `src/game/state.ts` to include the optional `pendingActions` summary in public game state. Update timeline rendering in `public/game/timeIndicatorView.js` to blink the portrait ring red for players who are required to submit and have not yet done so.

Finally, validate by running the server and stepping through a match to confirm the HUD visibility rules, rotation restriction behavior, pending submission blinking, and simultaneous reveal of actions. Document any ambiguities (such as missing card priorities or damage/KBF values) in the Decision Log and final summary.

## Concrete Steps

From the repository root (`c:\Users\marce\OneDrive\Documents\GitHub\HexStrike`):

1) Edit `public/index.html` to remove `.game-actions` and add the new action HUD structure (movement column, center slots + rotation wheel + submit button, ability column).

2) Edit `public/theme.css` to add HUD layout styles, card box styles for movement/ability, slot styling, locked state styling, and rotation wheel disabled/selected styling with a center label.

3) Add `public/game/cards.json` and (if needed) a small JS helper under `public/game/` to load the JSON and build the player hand.

4) Update `public/game/rotationWheel.js` to render the "rotation" center label and expose methods for `setValue`, `clear`, and `setAllowedRotations`.

5) Update `public/game.js` to replace the old action button wiring with the card HUD logic, including drag-and-drop, submit handling, and pending lock/reset behavior.

6) Update `public/game/timeIndicatorView.js` to blink the portrait ring red when a player is required to submit and has not yet done so, based on the new `pendingActions` state.

7) Update `src/types.ts`, `src/game/state.ts`, and `src/server.ts` to include and emit `pendingActions`, and to batch action sets when multiple players share the earliest `E`.

## Validation and Acceptance

Start the server with `npm run dev` and join a quickplay match in two browser windows. Acceptance criteria:

1) The old action modal is gone; the new card HUD appears only when the timeline selector is on the earliest highlighted `E` and the local player can act.

2) Movement cards appear on the left, four random ability cards on the right, and the rotation donut sits centered between the slots at the bottom center of the screen with the label "rotation" in its center.

3) Dragging one movement and one ability card into the active/passive slots enables the submit button once a legal rotation is selected; illegal rotation wedges are greyed out and an illegal selection is cleared when an active card is set.

4) When both players are at the same earliest `E`, submitting in one window does not immediately update the beats; instead the submitting player’s HUD locks, and the other player’s timeline portrait ring blinks red until they submit. Once both submit, actions appear together and both HUDs reset.

If automated tests are added, run `npm run build` followed by `npm run test` and expect all tests to pass.

## Idempotence and Recovery

Edits are additive and can be re-run safely by reapplying the same file changes. If the HUD renders incorrectly, revert only the changed files and reapply step-by-step. Pending action batching is in-memory only; restarting the server clears pending submissions and resets to the default game state.

## Artifacts and Notes

No artifacts yet.

## Interfaces and Dependencies

Define a new public state shape in `src/types.ts`:

    export interface PendingActions {
      beatIndex: number;
      requiredUserIds: string[];
      submittedUserIds: string[];
    }

    export interface GameStatePublic {
      land: HexCoord[];
      beats: BeatEntry[];
      characters: CharacterState[];
      pendingActions?: PendingActions;
    }

Extend `public/game/rotationWheel.js` to expose:

    buildRotationWheel(container, onSelect) -> {
      getValue(): string | null;
      setValue(value: string | null): void;
      clear(): void;
      setAllowedRotations(allowed: string[] | null): void;
    }

The card catalog lives at `public/game/cards.json` and must include movement and ability cards with fields: `id`, `name`, `priority`, `actions`, `rotations`, and for abilities `damage`, `kbf`.

## Plan Update Notes

Plan updated on 2025-12-20 20:12 to reflect implementation progress, clarify rotation-range interpretation, and document placeholder card values discovered during data entry.
