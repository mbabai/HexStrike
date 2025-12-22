# HexStrike Agent Guide

## Vision (long-term)
HexStrike is a Node.js, server-driven living card game played over a hex-grid. Players submit actions built from selected cards; the server validates, resolves outcomes on the hex board, and advances the authoritative game timeline. Clients are expected to connect via WebSockets and receive partial game states (their own hand and public board info; no opponent hand/deck visibility). The experience should feel like collaboratively making a movie that can be rewound and replayed.

## Current scope (lobby prototype)
- Server: dependency-light Node.js + TypeScript HTTP server in `src/server.ts` with REST endpoints and SSE (`GET /events`).
- State: lobby queues (`quickplayQueue`, `rankedQueue`, `botQueue`) and in-memory match/game records via `src/state/lobby.ts` and `src/persistence/memoryDb.ts`; games now include starting characters assigned on queue join.
- UI: static assets in `public/` with ES module scripts (`public/menu.js`, `public/queue.js`, `public/storage.js`) and styling in `public/theme.css`.
- UI action HUD uses movement/ability cards from `public/game/cards.json`, random hand selection in `public/game/cards.js`, and drag/drop wiring in `public/game/actionHud.js`.
- Action HUD hands are always rendered in a stacked spread, with turn-only slots/rotation and icon-driven card badges.
- Front-end animation: `public/game/timelinePlayback.js` builds beat-by-beat scenes (characters + effects) consumed by `public/game/renderer.js`.
- UI portrait badges (name capsules) are drawn with `public/game/portraitBadges.js`; local player accents use `--color-player-accent`.
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
- `game:update` payloads may include `pendingActions` in public state when concurrent players are submitting action sets.

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
- Action HUD only shows when the timeline selector is on the earliest `E` across all players and the local player is at-bat; the HUD locks after submit until resolution.
- Action HUD hands are always visible in the game view; only the slots and rotation wheel toggle with the `.is-turn` state.
- Action HUD hover targeting is based on the hand column + header band (not card transforms); keep `--action-card-hover-shift` synced with the hover rail in `public/game/actionHud.js`.
- Active/passive slots must be filled with cards from different sides (movement vs ability); only the active card drives the action list and rotation restrictions.
- Slot assignment overwrites same-type cards in the opposite slot by returning them to the hand.
- Action card UI always appends an `E` symbol and uses `/public/images/rot*.png`, `priority.webp`, `DamageIcon.png`, and `KnockBackIcon.png`.
- Keep beat arrays ordered by character roster when mutating to prevent UI rows from swapping entries.
- Timeline scrolling must clamp to the earliest `E` across all players, not just the local user.
- Timeline gold highlight uses the earliest `E` beat across all players, not the currently viewed beat.
- Rotation restrictions like `0-2` are interpreted as rotation magnitude (both left/right labels plus `0`/`3` where applicable), not directional ranges.
- When multiple players share the earliest `E`, the server batches action sets in `pendingActions` and reveals them simultaneously once all required players submit; timeline rings blink red for players still needed.
- Direction indexing for blocks/attacks must ignore reverse vectors (only forward, positive steps); otherwise block walls flip away from facing.
- Keep `getDirectionIndex` logic in `public/game/timelinePlayback.js` and `src/game/execute.ts` synchronized so visuals match server resolution.
- Rotation parsing treats `R` as +60 degrees per step and `L` as -60; keep that sign consistent in `public/game/timelinePlayback.js` and `src/game/execute.ts`.
- Knockback distance uses `max(1, floor((damage * KNOCKBACK_FACTOR) / KNOCKBACK_DIVISOR))`, and on hit the victim's timeline is rewritten from that beat with `DamageIcon`s plus a trailing `E`.
- When knockback has already been applied, re-execution must not erase actions placed after the trailing `E`; only the damage-icon window is authoritative.
- Node test runner reads from `dist`; run `npm run build` (or `tsc`) before `node --test test` when working on TS source.
- Timeline row separators must render before portrait rings so the local player highlight is visually on top.
- Board damage capsules are offset outside the ring and drawn without clipping so they sit over the border.
- Name capsule sizing is centralized in `public/game/portraitBadges.js`; pass config overrides for board vs timeline to keep consistency.
- Timeline playback timing is tuned in `public/game/timelinePlayback.js` via `ACTION_DURATION_MS` plus swipe/hit/knockback windows; adjust there before changing renderer effects.
- Trails are drawn as tapered polygons (sharp edges) in `public/game/renderer.js` instead of stroked lines; keep this in mind if changing trail caps or widths.
- Board portraits render in greyscale when the beat action is `DamageIcon`/`knockbackIcon`; keep the renderer's action tag matching server output.
- Damage previews during hit shakes are drawn via `displayDamage` on render characters to avoid double-counting at step end.

## PR expectations
- Summarize rule/engine changes clearly; include replay determinism notes when relevant.
- Include tests for new behaviors and note coverage in the PR description.

# Wrap up
When the user says "let's wrap this up" or something along those lines, execute the following steps:
- Refactor the most recently written code as necessary to make sure these methods are properly abstracted, encapsulated, built in extensible ways, and use the proper separations of controls/views/states on the front end UI. 
- Add/remove/update the gotchas into the AGENTS.md file graph so that we don't run into similar errors in the future. 
- Update the AGENTS.md file with any other relevant information to better understand the codebase. 
- Add any required tests (if needed).
