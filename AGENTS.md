# HexStrike Agent Guide

## Vision
HexStrike is a Node.js, server-driven living card game played over a hex-grid. Players submit actions built from selected cards; the server validates, resolves outcomes on the hex board, and advances the authoritative game timeline. Clients connect via WebSockets and receive partial game states (their own hand and public board info; no opponent hand/deck visibility). The experience should feel like collaboratively making a movie that can be rewound and replayed.

# ExecPlans
 
When writing complex features or significant refactors, use an ExecPlan (as described in .agent/PLANS.md) from design to implementation.

## Architectural principles
- **Front-end UI**: For any browser-facing UI styling or layout, follow `front-end-ui.md` as the single source of truth for palette, components, and interactions. Extend that document when adding reusable primitives.
- **Platform**: Node.js with TypeScript preferred for type safety; keep server code framework-light (e.g., bare ws/fastify or similar minimal HTTP + WebSocket setup).
- **Bounded contexts**:
  - `matchmaking` (lobby, seat assignment, game bootstrap)
  - `rules` (card definitions, validation, action composition rules)
  - `engine` (frame timeline, resolver, board state transitions)
  - `persistence` (event/frame store; support rewind/replay)
  - `realtime` (WebSocket session management, fan-out, presence, auth)
- **State model**: Treat each frame as an immutable record containing inputs (actions), deterministic resolution output, and derived public/secret views. Store frames sequentially to enable rewind/fast-forward.
- **Data flow**:
  1. Client submits an action packet for a target frame.
  2. Server validates action legality against latest known frame for that player.
  3. Engine resolves the frame (simultaneous when applicable) and emits the next frame snapshot.
  4. Persistence appends frame; realtime broadcasts tailored partial state to each player.
- **Idempotency & ordering**: Actions must include frame indices and player IDs; server enforces monotonic progression and rejects duplicates.
- **Concurrency**: Support simultaneous turns by collecting all required player actions before resolution; implement timeouts/fallbacks for missing actions.
- **Determinism**: Randomness should be seeded per match and recorded in the frame to ensure replayability.

## Game timeline & replay
- Maintain a **frame ledger** (append-only) capturing: frame number, inputs, RNG seed/usage, resulting board state, per-player private deltas.
- Provide APIs to **rewind** (serve historical frames) and **fast-forward** (re-simulate from stored inputs when rules change or for validation).
- Consider a **derived cache** of the latest fully materialized state for quick reads, but treat the ledger as the source of truth.

## Board & rules
- Represent the hex grid with axial or cube coordinates; keep helpers/utilities isolated (e.g., `engine/hex/`).
- Cards should be data-driven (JSON/TS definitions) and versioned; rule resolution should be pure functions to allow deterministic replays.
- Action construction rules (e.g., multi-card combos, targeting constraints) should be enforced server-side; never trust client composition.

## WebSocket & client interactions
- Use a simple message envelope: `{ type, matchId, frame, payload, correlationId }`.
- Support message types for: join/leave, action-submit, action-reject, frame-update, rewind-response, error.
- Send **partial state** to each player: hand + public board + their own secret info; never leak opponent deck/hand.
- Keep messages versioned for forward compatibility.

## Persistence & operations
- Prefer a schema that can be ported between JSONL/event store and relational DB; avoid backend-specific assumptions.
- Log all frame resolutions with enough data to re-run matches for debugging.
- Add lightweight metrics around action latency, frame resolution time, and connection health.

## Testing & validation
- Unit-test rule resolution and action validation heavily; snapshot tests for deterministic frames are encouraged.
- Include replay tests to ensure a recorded ledger re-simulates identically.
- Lint and type-check CI should block merges; favor fast, deterministic tests.

## Style & conventions
- Use TypeScript, ES2020+ modules, and eslint/prettier defaults; no try/catch around imports.
- Keep pure logic (rules/engine) free of I/O; isolate side effects in adapters.
- Small, focused modules; avoid monolithic files.
- Prefer functional, deterministic code paths for the engine; inject randomness sources.

## Repository conventions
- Add new AGENTS.md files in subdirectories when specialized instructions are needed; nested instructions override this file.
- Document new protocols (message schemas, frame structure) in `docs/` with examples.
- Update this guide if architectural decisions change.

## PR expectations
- Summarize rule/engine changes clearly; include replay determinism notes when relevant.
- Include tests for new behaviors and note coverage in the PR description.
