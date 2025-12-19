# Queue Matchmaking, Reconnects, and Game Area Canvas

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. Maintain this document according to `PLANS.md` at the repository root.

## Purpose / Big Picture

Enable the lobby server to auto-match the Quickplay queue every two seconds, create first-to-three matches with a skeleton game, and notify both players via SSE. Persist user identity in a browser cookie so reconnects can rejoin ongoing matches and show the game area, which is a full-page canvas rendering an infinite hex grid with pan/zoom + momentum.

## Progress

- [x] (2025-12-18 20:50Z) Drafted ExecPlan for queue matchmaking, reconnects, and game-area canvas.
- [x] (2025-12-18 21:15Z) Implemented server-side matchmaking polling, match/game creation updates, and reconnect lookups.
- [x] (2025-12-18 21:25Z) Updated client identity storage, SSE event handling, and game-area UI toggling.
- [x] (2025-12-18 21:35Z) Implemented canvas hex grid rendering with pan/zoom + momentum and styling updates.
- [x] (2025-12-18 22:05Z) Adjusted game-area clipping and scaled hex stroke width with hex size.
- [ ] Validate TypeScript build, tests, and manual lobby/game flow in the browser.

## Surprises & Discoveries

- None yet.

## Decision Log

- Decision: Use SSE `match:created` and `game:update` to notify only the two matched players, and re-send those events on reconnect when a user has an active match.
  Rationale: This keeps existing event shapes while ensuring reconnects receive their match/game without exposing data to other clients.
  Date/Author: 2025-12-18 / assistant
- Decision: Store the user ID in a browser cookie and continue passing it in `/events` and queue join/leave requests.
  Rationale: Cookies persist across sessions and meet the requirement without changing the server API contract.
  Date/Author: 2025-12-18 / assistant
- Decision: Render a pointy-top axial hex grid in the canvas and source fill/stroke colors from new theme variables.
  Rationale: Axial coordinates simplify infinite grid sampling while keeping colors aligned with the shared palette rules.
  Date/Author: 2025-12-18 / assistant
- Decision: Introduce a `.game-frame` wrapper for clipping and make hex stroke width proportional to hex size.
  Rationale: Nested clipping resolves wide-screen canvas bleed and proportional strokes preserve line weight across zoom levels.
  Date/Author: 2025-12-18 / assistant

## Outcomes & Retrospective

- Pending implementation.

## Context and Orientation

The server lives in `src/server.ts` and uses `src/state/lobby.ts` for queues and `src/persistence/memoryDb.ts` for in-memory users/matches/games. Shared types are in `src/types.ts`. The lobby UI lives in `public/index.html`, `public/index.js`, and feature modules such as `public/queue.js`, `public/presence.js`, and `public/storage.js`. Styling is defined in `public/theme.css` and must follow the palette guidance in `front-end-ui.md`.

## Plan of Work

Update the server to poll the Quickplay queue every two seconds, take the first two queued users, mark them in-game, create a new match and skeleton game with `winsRequired = 3`, and send targeted SSE events to those players. Add lookup helpers in `MemoryDb` to find the active match/game for a user so `serveEvents` can re-send match/game state when that user reconnects. On the client, switch user ID storage from localStorage to cookies, and parse SSE messages so `match:created` or `game:update` toggles the UI into game mode. Add a new `public/game.js` module to render a full-page canvas hex grid with pan/zoom + momentum, and extend `public/theme.css` with styles for the game area and hex colors using existing CSS variables.

## Concrete Steps

1. Edit `src/types.ts` to add a `winsRequired: number` field on `MatchDoc`.
2. Extend `src/persistence/memoryDb.ts` with helpers like `findMatch`, `findActiveMatchByUser`, and `findGame`.
3. Update `src/server.ts` to:
   - Add a matchmaking interval that runs every 2000ms and pairs the first two Quickplay queue entries.
   - Create a match + game with `winsRequired = 3`, mark users in-game, and send `match:created` + `game:update` to each user.
   - On `/events` connect, look up active match/game for that user and re-send events.
4. Update `public/storage.js` to read/write the user ID cookie.
5. Update `public/presence.js` to parse SSE messages and dispatch custom events for match/game updates.
6. Update `public/queue.js` to stop the searching timer when a match event arrives.
7. Add `public/game.js` and update `public/index.js` + `public/index.html` to mount the game area and initialize the renderer.
8. Extend `public/theme.css` with `.game-area`, `.game-canvas`, and hex color variables derived from the existing palette.
9. Update `test/memoryDb.test.js` to include the new `winsRequired` property and, if added, cover new lookup helpers.

## Validation and Acceptance

After running `npm run build`, starting the server, and opening the lobby page, clicking Find Game twice in two browser sessions should queue both users. Within 2 seconds, both clients should receive `match:created` and `game:update` events and the Find Game panel should hide while the game canvas appears. Reloading a client should reconnect via its cookie-stored user ID and immediately show the same match/game state. The canvas must display a dark-blue hex grid with light-blue edges, allow left-click drag panning with momentum, and zoom with the mouse wheel. Run `npm run test` and expect the updated memory DB tests to pass.

## Idempotence and Recovery

The matchmaking loop and reconnect logic are safe to repeat; they only act when enough queue members exist. UI changes are additive and can be reverted by removing the new game-area markup and JS module. If a build fails, fix TypeScript errors and re-run `npm run build`.

## Artifacts and Notes

Expect server logs like `[lobby] <username> (<userId>) joined quickplay queue` when joining. On reconnect, the SSE stream should include `match:created` and `game:update` for the reconnecting user shortly after the `connected` event.

## Interfaces and Dependencies

- `MatchDoc` in `src/types.ts` includes `winsRequired: number`.
- `MemoryDb` in `src/persistence/memoryDb.ts` exposes `findMatch(id)`, `findActiveMatchByUser(userId)`, and `findGame(id)` helpers.
- `buildServer` in `src/server.ts` runs a 2000ms matchmaking interval and sends targeted SSE events for match/game creation.
- `public/game.js` exports `initGame()` to mount the canvas and handle pan/zoom rendering.
- `public/presence.js` dispatches custom events (for example `hexstrike:match` and `hexstrike:game`) from SSE messages.

Change Note (2025-12-18 20:50Z): Created this ExecPlan to cover matchmaking polling, reconnect handling, cookie-based user IDs, and the game-area canvas UI.
Change Note (2025-12-18 21:35Z): Updated Progress and Decision Log to reflect implemented server/client/canvas changes; validation still pending.
Change Note (2025-12-18 22:05Z): Logged the clipping wrapper and proportional stroke adjustments.
