# HexStrike Architecture

## Scope and goals
HexStrike is a dependency-light Node.js + TypeScript server with a static browser client. The server owns the authoritative lobby and game state, validates card submissions, resolves the hex-grid timeline, and pushes partial state to players over SSE or WebSockets. The client is an ES module front end that renders the lobby, deck builder, and game board.

## Runtime topology
- Single Node process started by `src/index.ts`, hosting HTTP, SSE, WebSocket, and static asset routes.
- Memory-only persistence (`MemoryDb`); all users, matches, and games reset on restart.
- In-memory deck state per game, separate from stored game docs, to keep private hands server-side.

## High-level flow
1. Players join a lobby queue and optionally submit a deck definition.
2. Quickplay matchmaking pairs the oldest two players; bot queues start immediate 1v1 matches versus the selected bot profile.
3. A match and game are created; initial state is seeded with characters and a first timeline beat.
4. The server emits `match:created` and `game:update` events.
5. Players submit action sets at the earliest open unresolved beat (`resolvedIndex + 1` onward); the server validates cards, applies actions, executes beats, resolves interactions, refreshes decks, and evaluates match end conditions.
6. `game:update` events stream to each player with public state plus their private card state.

## Server responsibilities (src/)
### Core entrypoints
- `src/index.ts` boots the HTTP server via `buildServer`.
- `src/server.ts` handles REST routing, SSE, WebSockets, and static file serving.

### Lobby and persistence
- `src/state/lobby.ts` maintains queue snapshots and emits `queueChanged`.
- `src/persistence/memoryDb.ts` stores users, matches, and games in memory.

### Matchmaking
- Quickplay pairing runs on a timer and consumes the first two users in `quickplayQueue`.
- `botHardQueue`, `botMediumQueue`, and `botEasyQueue` create per-match bots (`Strike-bot`, `Hex-bot`, `Bot-bot`), assign one of the three base decks at random, and run server-side bot submissions for action sets + interactions.
- `custom` matches can be created via the API for explicit host/guest pairing.

### HTTP API surface
- Lobby endpoints under `/api/v1/lobby` for queue join/leave/clear and admin presence.
- Match endpoints under `/api/v1/match` for custom matches, match end, and player exit.
- Game endpoints under `/api/v1/game` for action sets, interaction resolution, and snapshots.
- History endpoints under `/api/v1/history` for recent matches and games.

### Game state model
- `GameDoc` carries `state.public` (shared) and `state.secret` (currently empty).
- `state.public` includes:
  - `land`: list of land hexes.
  - `beats`: array of beats, each beat an array of per-character entries.
  - `characters`: roster with positions and facing.
  - `pendingActions`: tracked when multiple players submit simultaneously.
  - `customInteractions`: pending/resolved interactions (throw, discard, draw, combo/guard choices, rewind focus/return, hand triggers, haven platform).
  - `matchOutcome`: populated when the match ends.
- Deck state is stored separately in `gameDeckStates` and merged into player views.

### Card catalog and deck state
- Card data lives in `public/cards/cards.json` and is loaded by `src/game/cardCatalog.ts`.
- Character powers live in `public/characters/characters.json`; server reads them through `src/game/characterPowers.ts`, client reads them through `public/shared/characterCatalog.js`.
- Deck definitions require 4 movement cards and 12 ability cards; duplicates are rejected.
- `src/game/cardRules.ts` manages deck state:
  - Movement cards are always in the "hand" but exhaust on use.
  - Ability cards are drawn into a 4-card hand; used cards go to the bottom of the deck.
  - Refreshes on land clear movement exhaustion and refill the ability hand (base max may be overridden by character powers).

### Action submission pipeline
- `input:request` is emitted when a player is at the earliest open beat or a throw requires a direction.
- `submitActionSet` validates cards and rotations, applies card costs, and either:
  - executes immediately if only one player is required, or
  - batches in `pendingActions` until all required players submit.
- `applyActionSetToBeats` inserts the action list at the player's first open unresolved beat and clears later entries for that player.
- `executeBeatsWithInteractions` recomputes positions, damage, and interactions from the start of the timeline.
- Replay mutators in `executeBeatsWithInteractions` treat committed future starts as protected boundaries (`rotationSource: 'selected'`, `comboStarter`, committed rewind-return starts) and must clamp rewrite/prune windows before those beats.
- `BeatEntry.consequences` stores per-beat hit outcomes used by timeline badges (`damageDelta` positive for damage, negative for healing; `knockbackDistance` for knockback capsules).
- `resolveLandRefreshes` applies deck refresh rules after execution.
- `evaluateMatchOutcome` determines win/loss conditions and inserts `Death` beats when needed.

### Rules engine modules
- `src/game/execute.ts`: deterministic beat resolution (rotation, movement, attacks, blocks, knockback, throws).
- `src/game/actionSets.ts`: inserts action lists into the shared timeline.
- `src/game/beatTimeline.ts`: helpers for earliest open beats and positions.
- `src/game/matchEndRules.ts`: distance and no-cards loss logic.
- `src/game/hexGrid.ts`: land tiles and terrain detection.
- `src/game/state.ts`: starting positions, facing, and initial beats.
- `src/game/timelineEngine.ts`: generic timeline helpers (currently unused by runtime).

### Realtime messaging
- SSE endpoint: `GET /events?userId=...`
- WebSocket endpoint: `GET /ws?userId=...&username=...`
- Envelope: `{ type, payload, recipient }`
- Typical events:
  - `connected`, `queueChanged`, `match:created`, `game:update`, `match:ended`, `bot:error`
  - `input:request` for action sets or throw resolution
  - `input:ack`, `interaction:ack`, `error` (WebSocket responses)

## Client architecture (public/)
### Pages
- `public/index.html`: lobby + game shell.
- `public/cards.html`: card catalog view.
- `public/admin.html`: presence/queue monitor.

### Lobby modules
- `public/index.js` initializes menu, deck builder, queue, game, and SSE presence.
- `public/presence.js` opens `/events` and dispatches `hexstrike:*` events.
- `public/queue.js` handles quickplay and bot-queue join/leave plus queueing UI state.
- `public/decks.js` + `public/deckStore.js` manage deck creation and persistence in localStorage.
- `public/storage.js` stores user id and selected deck id in cookies.
- `public/cards.js` renders the card catalog page.

### Game view modules
- `public/game.js` orchestrates the game canvas, action HUD, timeline playback, and HTTP submissions.
- `public/game/renderer.js` draws the board and characters.
- `public/game/timelinePlayback.js` mirrors the server resolution logic to animate each beat; slider speed scales movement/rotation fully while attack/hit visuals scale at half-rate.
- `public/game/actionHud.js` + `public/game/rotationWheel.js` manage card selection and rotation.
- `public/game/timeIndicatorView.js` provides the timeline stepper and play/pause control; `public/game.js` owns turtle/rabbit speed slider state + beat auto-advance cadence.
- `public/game/interactionState.mjs` selects pending interactions (throw/discard/draw/combo/guard/rewind/hand-trigger/haven) for the UI overlay.
- `public/game/controls.js` + `public/game/viewState.js` manage panning, zooming, and input.
- `public/game/portraitBadges.js` and `public/game/characterTokens.mjs` draw UI badges and facing arrows.
- `public/game/timelineTooltip.js` derives tooltips from card text.

### Shared utilities and assets
- `public/shared/hex.mjs` defines axial directions and pixel conversions for rendering.
- `public/shared/cardRenderer.js` renders card faces and text.
- Icons and portraits live in `public/images`.

## Build and test
- TypeScript compiles to `dist/`.
- Tests live under `test/` and run against `dist` via Node's test runner.
- `npm run dev` builds, runs tests, and starts the server on success.
