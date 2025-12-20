# HexStrike Agent Guide

## Vision (long-term)
HexStrike is a Node.js, server-driven living card game played over a hex-grid. Players submit actions built from selected cards; the server validates, resolves outcomes on the hex board, and advances the authoritative game timeline. Clients are expected to connect via WebSockets and receive partial game states (their own hand and public board info; no opponent hand/deck visibility). The experience should feel like collaboratively making a movie that can be rewound and replayed.

## Current scope (lobby prototype)
- Server: dependency-light Node.js + TypeScript HTTP server in `src/server.ts` with REST endpoints and SSE (`GET /events`).
- State: lobby queues (`quickplayQueue`, `rankedQueue`, `botQueue`) and in-memory match/game records via `src/state/lobby.ts` and `src/persistence/memoryDb.ts`; games now include starting characters assigned on queue join.
- UI: static assets in `public/` with ES module scripts (`public/menu.js`, `public/queue.js`, `public/storage.js`) and styling in `public/theme.css`.
- UI action buttons for gameplay live in `public/index.html` and are wired via `actionConfigs` in `public/game.js`.
- Front-end animation: `public/game/timelinePlayback.js` builds beat-by-beat scenes (characters + effects) consumed by `public/game/renderer.js`.
- Matchmaking: Quickplay join/leave is wired from the UI; other queue options are placeholders.

# Documentation map (start here)
- [README.md](README.md): project overview, setup, and API summary; read first when onboarding or running the server.
- [PLANS.md](PLANS.md): ExecPlan format and rules; use whenever drafting or executing a large feature/refactor plan.
- [front-end-ui.md](front-end-ui.md): UI palette, components, and interaction rules; use for any browser-facing UI changes.
- [docs/hex-grid.md](docs/hex-grid.md): hex coordinate system and land/abyss definitions; use when touching board math or terrain.
- [plans/basic-lobby.md](plans/basic-lobby.md): historical lobby plan snapshot; reference for context on the initial lobby scope.
- [plans/queue-matchmaking-game-area.md](plans/queue-matchmaking-game-area.md): historical plan for queue/matchmaking/game surface; reference when revisiting those areas.

# ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in `PLANS.md`) from design to implementation.

## Architectural principles (current)
- Front-end UI: For any browser-facing UI styling or layout, follow `front-end-ui.md` as the single source of truth for palette, components, and interactions. Extend that document when adding reusable primitives.
- Platform: Node.js with TypeScript preferred for type safety; keep server code framework-light (dependency-light HTTP + SSE).
- Bounded contexts (implemented): `matchmaking` (lobby, seat assignment, game bootstrap) and `persistence` (in-memory data).
- State model: Lobby snapshots and match/game records are kept in memory; no frame ledger exists yet. Game public state includes `characterName` on characters, and beats reference players by `username`.

## Realtime and client interactions (current)
- SSE message envelope: `{ type, payload, recipient }`.
- Message types currently emitted: `connected`, `queueChanged`, `match:created`, `game:update`, `match:ended`.
- REST endpoints live under `/api/v1/lobby`, `/api/v1/match`, and `/api/v1/history`.

## Persistence and operations (current)
- `MemoryDb` in `src/persistence/memoryDb.ts` is the only persistence layer and resets on restart.
- Quickplay joins are logged to the server console for visibility.

## Testing and validation (current)
- Use the Node.js built-in test runner (`npm run test`).
- `npm run dev` builds, runs tests, and only starts the server when tests pass.

## Planned gameplay architecture (future)
- Bounded contexts: `rules`, `engine`, `realtime`, and a durable `persistence` layer for frame replays.
- State model: Treat each frame as an immutable record containing inputs (actions), deterministic resolution output, and derived public/secret views. Store frames sequentially to enable rewind/fast-forward.
- Data flow: client action -> validation -> deterministic frame resolution -> persistence append -> realtime broadcast.
- Idempotency and ordering: actions include frame indices and player IDs; server enforces monotonic progression and rejects duplicates.
- Concurrency: support simultaneous turns by collecting all required player actions before resolution; implement timeouts/fallbacks for missing actions.
- Determinism: randomness seeded per match and recorded in the frame.
- Board and rules: represent the hex grid with axial or cube coordinates; card definitions are data-driven and versioned; rule resolution should be pure functions.

## Style and conventions
- Use TypeScript; the Node build targets ES2020 and CommonJS output today. Add eslint/prettier defaults if introduced; no try/catch around imports.
- Keep pure logic (rules/engine) free of I/O; isolate side effects in adapters.
- Small, focused modules; avoid monolithic files.
- Prefer functional, deterministic code paths for the engine; inject randomness sources.

## Repository conventions
- Add new AGENTS.md files in subdirectories when specialized instructions are needed; nested instructions override this file.
- Document new protocols (message schemas, frame structure) in `docs/` with examples.
- Update this guide if architectural decisions change.

## Gotchas (current)
- Beat entries include `damage`, `location`, and `priority` fields; tests should assert full beat payloads, not just `username`/`action`.
- Action-set insertion is per player: replace that player's first open slot (missing entry or `E`), fill empty beats in place, and avoid shifting other players' beats.
- Action-set rotations only apply to the first action entry; subsequent actions must use a blank rotation to keep timelines aligned.
- Action buttons only enable after a rotation is selected; new buttons must be added to `public/game.js` `actionConfigs` to wire enablement + handler behavior.
- Keep beat arrays ordered by character roster when mutating to prevent UI rows from swapping entries.
- Timeline scrolling must clamp to the earliest `E` across all players, not just the local user.
- Direction indexing for blocks/attacks must ignore reverse vectors (only forward, positive steps); otherwise block walls flip away from facing.
- Keep `getDirectionIndex` logic in `public/game/timelinePlayback.js` and `src/game/execute.ts` synchronized so visuals match server resolution.
- Rotation parsing treats `R` as +60 degrees per step and `L` as -60; keep that sign consistent in `public/game/timelinePlayback.js` and `src/game/execute.ts`.
- Node test runner reads from `dist`; run `npm run build` (or `tsc`) before `node --test test` when working on TS source.

## PR expectations
- Summarize rule/engine changes clearly; include replay determinism notes when relevant.
- Include tests for new behaviors and note coverage in the PR description.

# Wrap up
When the user says "let's wrap this up" or something along those lines, execute the following steps:
- Refactor the most recently written code as necessary to make sure these methods are properly abstracted, encapsulated, built in extensible ways, and use the proper separations of controls/views/states on the front end UI. 
- Add/remove/update the gotchas into the AGENTS.md file graph so that we don't run into similar errors in the future. 
- Update the AGENTS.md file with any other relevant information to better understand the codebase. 
- Add any required tests (if needed).
