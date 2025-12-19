# Basic lobby and skeleton game server

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. Maintain this document according to `PLANS.md` at the repository root.

## Purpose / Big Picture

Enable a minimal yet observable lobby and game bootstrap flow so a user can start the server, load the menu UI, toggle quickplay queue search, and see lobby updates through REST state reads and SSE events. Creating a custom match should remove players from queues, create placeholder Match and Game records, and broadcast events that the front end can observe.

## Progress

- [x] (2025-02-06 12:00Z) Drafted ExecPlan outlining lobby, server, and front-end scaffolding work.
- [x] (2025-02-06 12:20Z) Scaffolded Node.js/TypeScript project structure, build scripts, and gitignore without external dependencies.
- [x] (2025-02-06 12:45Z) Implemented lobby state module with queue helpers and event bus.
- [x] (2025-02-06 13:10Z) Added in-memory persistence layer representing users, matches, and skeleton games.
- [x] (2025-02-06 13:50Z) Built HTTP server with lobby routes, history endpoints, and SSE-based event streaming.
- [x] (2025-02-06 14:05Z) Created a browser UI and wired queue actions with REST calls.
- [x] (2025-02-06 14:20Z) Validated TypeScript build; manual front-end exercise available via local server.
- [x] (2025-12-18 17:24-08:00) Updated the plan to reflect the current menu UI, queue toggle flow, and in-memory persistence.

## Surprises & Discoveries

- Observation: npm registry access returned 403 errors, blocking installation of Express/Socket.IO and type packages.
  Evidence: `npm error 403 Forbidden - GET https://registry.npmjs.org/express` during attempted install.

## Decision Log

- Decision: Replace external dependencies (Express, Socket.IO, Mongoose) with a dependency-free HTTP server plus Server-Sent Events and an in-memory data store.
  Rationale: npm registry access was blocked, so custom implementations keep the feature working end-to-end without downloads while still matching the requested behaviors.
  Date/Author: 2025-02-06 / assistant
- Decision: Keep the browser UI as static assets served by the same HTTP server and use REST for queue joins/leaves, leaving SSE as a read-only event stream for now.
  Rationale: The UI now focuses on a Quickplay queue toggle, while SSE remains available for future live updates without introducing a client framework.
  Date/Author: 2025-12-18 / assistant

## Outcomes & Retrospective

- Completed a dependency-free lobby sandbox with SSE-driven updates, in-memory persistence, and a menu-style browser UI that toggles quickplay queue search. TypeScript compilation succeeds and the flows match the requested queue/match lifecycle behaviors despite the npm registry limitation.

## Context and Orientation

The repository includes a dependency-free Node.js/TypeScript server under `src/`, static assets under `public/`, and an in-memory persistence layer in `src/persistence/`. Lobby state lives in `src/state/lobby.ts` and is reused by both HTTP routes and Server-Sent Events handlers. The server entry point starts the HTTP server, wires routes, and serves the front-end. The browser UI uses ES modules (`public/menu.js`, `public/queue.js`, `public/storage.js`) to handle menu toggles and Quickplay queue requests.

## Plan of Work

Scaffold the project with `package.json`, `tsconfig.json`, and ignore files so TypeScript sources compile to `dist/`, keeping dependencies optional due to registry blocks. Implement `src/state/lobby.ts` to track `quickplayQueue`, `rankedQueue`, `botQueue`, and `inGame` arrays with helper methods to add/remove users, clear queues, and emit `queueChanged` via an EventEmitter. Define in-memory models for `User`, `Match`, and `Game` capturing the requested fields, keeping the game schema intentionally skeletal while reflecting the requested behaviors. Build `src/server.ts` to create a dependency-free HTTP server, clear lobby queues on startup, expose `/api/v1/lobby/*` routes for joining/leaving/clearing queues and for reading state, add history endpoints for recent matches/games, and wire Server-Sent Events handlers that broadcast lobby and match updates. Custom match creation should remove players from queues, place them in `inGame`, create placeholder `Match` and `Game` records, and broadcast `queueChanged`, `match:created`, and `game:update` events. Serve a menu-driven `public/index.html` that uses `public/queue.js` to toggle Quickplay search via REST calls and shows placeholder options for other queues. Finally, add `src/index.ts` to start the server and allow bot hooks after listening. Validate by building the project and loading the front-end to exercise the basic flows.

## Concrete Steps

- From the repository root, run `npm init -y` (done) and keep scripts configured for `tsc`-based builds since registry access is blocked.
- Add `tsconfig.json` targeting modern Node (ES2020) with `outDir` set to `dist/` and `rootDir` to `src/`.
- Create `src/state/lobby.ts` implementing the lobby queues and event bus helpers.
- Create `src/persistence/memoryDb.ts` defining in-memory collections that mimic documents for users, matches, and the skeletal game document.
- Implement `src/server.ts` to build the HTTP app, initialize lobby state, set up routes, and attach Server-Sent Events handlers for lobby state and match events.
- Implement `src/index.ts` to start the HTTP server and allow internal bot hooks after listening.
- Build `public/index.html`, `public/menu.js`, `public/queue.js`, and `public/storage.js` with a menu layout and a Quickplay queue toggle.
- Update `.gitignore` to exclude build artifacts and environment files; update `package.json` scripts for `build`, `start`, and `dev`.
- Validate with `npm run build` and run `npm start`, then load the front-end to verify lobby interactions.

## Validation and Acceptance

Acceptance requires the server to start with `npm start`, serving `public/index.html` at the root. Using the page, a user can click Find Game while Quickplay is selected to join the Quickplay queue, see the button enter searching mode, and cancel to leave the queue. Non-Quickplay selections should show an alert. Creating a custom match via the API should remove involved users from queues, add them to `inGame`, create placeholder Match and Game records in the in-memory store, and emit `match:created` and `game:update` events. The `/events` SSE stream should emit `queueChanged` events when queues change, and history endpoints should return lists of stored matches and games. TypeScript compilation via `npm run build` must succeed.

## Idempotence and Recovery

Running the setup commands repeatedly is safe. Lobby queues clear on server start to avoid stale data. The in-memory store restarts cleanly with each server restart. If build errors occur, re-run `npm run build` after fixing TypeScript errors.

## Artifacts and Notes

During validation, expect TypeScript compilation to produce a `dist/` directory. Starting the server should log `HexStrike lobby server listening on http://localhost:3000`. Joining the Quickplay queue should log a message like `[lobby] <username> (<userId>) joined quickplay queue`. The SSE endpoint should emit `queueChanged`, `match:created`, and `game:update` events after interactions.

## Interfaces and Dependencies

- `src/state/lobby.ts` exports `createLobbyStore` returning an object with `quickplayQueue`, `rankedQueue`, `botQueue`, `inGame`, `events` (EventEmitter), and helpers `addToQueue(userId, queue)`, `removeFromQueue(userId, queue)`, `markInGame(userIds)`, `clearQueues()`, and `serialize()`.
- SSE handlers should broadcast `queueChanged`, `match:created`, `game:update`, and `match:ended` event packets.
- REST routes under `/api/v1/lobby` support POST `join`, POST `leave`, POST `clear`, and GET `state`. Match routes support POST `custom` and POST `:matchId/end`. History routes under `/api/v1/history` return recent matches and games.
- Models are represented in `src/persistence/memoryDb.ts`: `User` with username, optional email, elo, bot flags, and timestamps; `Match` with player info, scores, elo deltas, game reference, and lifecycle flags; `Game` with match link, players, timers, outcome, and timestamps.
- Front-end modules in `public/menu.js`, `public/queue.js`, and `public/storage.js` are loaded from `public/index.js` as ES modules.

Change Note (2025-12-18 17:24-08:00): Updated this ExecPlan to align with the current menu UI, REST queue flow, and SSE event shape; removed outdated Mongo references.
