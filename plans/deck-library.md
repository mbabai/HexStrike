# Add Deck Library, Builder, and Selection Flow

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This document must be maintained in accordance with PLANS.md in the repository root.

## Purpose / Big Picture

Players need to browse prebuilt decks, build custom decks, pick a deck for matchmaking, and see those cards and the chosen character used in-game. After this change, the lobby main page shows the base decks with portrait thumbnails and actions, a deck builder modal lets players assemble a deck from the full card catalog with filtering and sorting, deck selections are persisted per user, and queueing is gated on a selected deck. This is visible by starting the server, opening the lobby, selecting a deck to enable Find Game, and confirming the in-game hand uses the deck cards and the character portrait matches.

## Progress

- [x] (2025-12-22 23:45Z) Add deck data to the card catalog JSON and define shared card catalog/renderer helpers for reuse by the lobby and cards page.
- [x] (2025-12-22 23:45Z) Build lobby deck library UI, deck preview popup, and deck builder modal with filtering, selection, and saving for a user ID.
- [x] (2025-12-22 23:45Z) Persist deck selection in cookies and deck lists in localStorage, wire Find Game gating, and update in-game hands + server character assignment.
- [ ] (2025-12-22 23:45Z) Update CSS and documentation to reflect the new deck UI primitives and run validation steps (completed: CSS + docs; remaining: validation).

## Surprises & Discoveries

- None so far.

## Decision Log

- Decision: Store base deck definitions inside `public/cards/cards.json` under a new `decks` array and hydrate per-user decks from localStorage keyed by user ID.
  Rationale: The requirement explicitly references the card “database,” and this keeps base deck data in the same source while allowing per-user overrides without server persistence.
  Date/Author: 2025-12-22 / Codex

## Outcomes & Retrospective

- Implemented the deck catalog, lobby deck UI, deck builder workflow, selection persistence, and server character wiring. Manual validation and smoke testing remain outstanding.

## Context and Orientation

The lobby UI lives in `public/index.html`, `public/index.js`, and `public/theme.css`. Client-side modules in `public/menu.js`, `public/queue.js`, `public/game.js`, and `public/storage.js` provide menu controls, matchmaking, game bootstrapping, and cookie-based user IDs. The card catalog is `public/cards/cards.json` and powers the cards page (`public/cards.js`, `public/cards.css`). The in-game action HUD builds cards via `public/game/cards.js` and renders via `public/game/actionHud.js`. Character portraits are mapped in `public/game/characterTokens.mjs` and used by renderers. The server assigns characters in `src/server.ts` using IDs defined in `src/game/characters.ts` and types in `src/types.ts`. There is no server persistence beyond memory, so per-user deck storage must be client-side.

## Plan of Work

First, extend `public/cards/cards.json` with base deck definitions and add shared helpers in `public/shared/` for loading the card catalog and rendering full card UI. Next, build a new lobby deck module (`public/decks.js`) plus storage helpers (`public/deckStore.js`) and update the lobby HTML to include the deck grid, selected deck preview, and modals. Update `public/theme.css` with deck grid, modal, and card spread styles so the UI matches the existing theme. Then wire deck selection into queueing (`public/queue.js`) and in-game hand building (`public/game.js`, `public/game/cards.js`) so the selected deck governs the hand. Finally, update character ID mappings in `public/game/characterTokens.mjs`, `src/types.ts`, `src/game/characters.ts`, and `src/server.ts` so selected deck characters are honored server-side, and document the new UI primitives in `front-end-ui.md`.

## Concrete Steps

Work from `c:\Users\marce\OneDrive\Documents\GitHub\HexStrike`.

1) Edit `public/cards/cards.json` to add a `decks` array containing the two base decks with `id`, `name`, `characterId`, `movement`, and ordered `ability` card ID lists.

2) Create `public/shared/cardCatalog.js` exporting a memoized `loadCardCatalog()` that returns normalized `movement`, `ability`, and `decks` arrays from the JSON.

3) Create `public/shared/cardRenderer.js` exporting `buildCardElement(card, options)` and `fitAllCardText(root)` to render full card UI with active/passive text and to auto-fit text.

4) Update `public/cards.js` to import and use the shared catalog + renderer modules.

5) Create `public/deckStore.js` with helpers to read/write per-user deck lists in localStorage, load base decks when missing, generate deck IDs, and fetch the selected deck for a user.

6) Update `public/index.html` to include the deck library panel, selected deck preview block near the Find Game panel, a deck preview overlay, and a deck builder modal (plus deck naming modal).

7) Create `public/decks.js` to render the deck library, preview popup, and deck builder. Implement filtering/sorting, character selection, selection spreads, ability drag-and-drop ordering, and save/delete/select actions. Dispatch `hexstrike:deck-selected` and `hexstrike:decks-updated` events when state changes.

8) Update `public/index.js` to call `initDecks()` before initializing queue/game.

9) Extend `public/storage.js` to include cookie helpers for the selected deck ID.

10) Update `public/queue.js` to disable Find Game until a deck is selected, apply gold styling when selected, and include `characterId` in the `/api/v1/lobby/join` payload.

11) Update `public/game/cards.js` to build hands from the selected deck and to load from `public/cards/cards.json`. Update `public/game.js` to apply deck selection to the action HUD and listen for deck selection updates.

12) Update `public/game/characterTokens.mjs`, `src/types.ts`, `src/game/characters.ts`, and `src/server.ts` to add new character IDs and accept selected character IDs from the join payload.

13) Extend `public/theme.css` with deck grid, modal, and deck preview styles; update `front-end-ui.md` with any new reusable UI primitives.

## Validation and Acceptance

Run `npm run dev` from the repository root and visit `http://localhost:8080/`. Verify the deck library panel shows the two base decks with portraits and a Create New Deck button. Clicking a deck opens a horizontal card spread and clicking outside closes it. Creating a deck allows filtering/sorting the library, selecting a character, selecting 4 movement and 12 ordered ability cards, rearranging ability order via drag and drop, and saving a named deck. The deck appears in the library, can be selected with the check icon (enabling Find Game), and deleted via the trash icon. When Find Game is clicked with a selected deck, the in-game action HUD uses the selected deck’s cards and the character portrait matches the deck’s character.

## Idempotence and Recovery

All steps are additive and can be rerun safely. If the deck UI behaves unexpectedly, clear the browser localStorage key `hexstrikeDecks:<userId>` and the cookie `hexstrikeSelectedDeckId` to reset deck state. Re-running the server restores defaults because decks are stored client-side only.

## Artifacts and Notes

No external artifacts yet.

## Interfaces and Dependencies

The deck UI relies on new `public/shared/cardCatalog.js` and `public/shared/cardRenderer.js` modules. `public/deckStore.js` must expose `loadUserDecks(userId)`, `saveUserDecks(userId, decks)`, `getSelectedDeck(userId)`, and `createDeckId()` functions. `public/decks.js` must export `initDecks()` and dispatch `hexstrike:deck-selected` and `hexstrike:decks-updated` events. The server’s `/api/v1/lobby/join` endpoint must accept an optional `characterId` string matching the expanded `CharacterId` union type.

Plan update note (2025-12-22): Updated Progress and Outcomes to reflect completed implementation tasks and the remaining validation step.
