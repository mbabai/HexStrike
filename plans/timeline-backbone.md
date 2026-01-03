# Rebuild Timeline Backbone and Realtime Sync

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

PLANS.md is checked in at `PLANS.md` from repo root and this document must be maintained in accordance with it.

## Purpose / Big Picture

After this change, the server boots again, owns the authoritative timeline, prompts players for inputs, resolves beats deterministically, and broadcasts incremental state updates over WebSockets (with SSE retained for legacy clients). Clients can reconnect or spectate through a REST snapshot and see the same `public.beats` timeline the UI already renders. The new timeline types (Beat, Trigger, Timeline) and input flow are encoded in TypeScript so the next iteration of the rules engine can build on a stable backbone.

## Progress

- [x] (2026-01-01T19:24:04-08:00) Audited dist outputs and tests to identify missing modules and expected data shapes.
- [x] (2026-01-01T21:29:39-08:00) Defined core types, timeline engine scaffolding, and Node shim updates.
- [x] (2026-01-01T21:29:39-08:00) Restored game logic modules and added the browser beat timeline helper.
- [x] (2026-01-01T21:29:39-08:00) Rebuilt the server with WebSocket sync, input prompts, and snapshot endpoint, plus protocol docs.
- [x] (2026-01-01T21:29:39-08:00) Built and ran the test suite (18 passing).

## Surprises & Discoveries

- Observation: `src/server.ts` and several `src/game/*.ts` modules are missing while compiled versions remain in `dist/`.
  Evidence: `dist/server.js`, `dist/game/execute.js`, and `dist/game/cardRules.js` exist but have no TS sources.
- Observation: Front-end and tests read `public.beats`, while the last compiled server used `public.timeline`.
  Evidence: `public/game/timeIndicatorView.js` and `test/gameState.test.js` both reference `public.beats`.
- Observation: `npm run build` fails in PowerShell due to execution policy, but `cmd /c npm run build` succeeds.
  Evidence: PowerShell reported `running scripts is disabled on this system`.

## Decision Log

- Decision: Keep `public.beats` as the canonical timeline for now and add new Timeline/Beat/Trigger types in `src/types.ts` for future engine work.
  Rationale: This preserves UI/test compatibility while introducing the abstract architecture requested.
  Date/Author: 2026-01-01 / Codex
- Decision: Implement WebSocket handshake and framing in-repo without adding dependencies.
  Rationale: The project is dependency-light and network access is restricted; implementing the minimal protocol keeps the server buildable.
  Date/Author: 2026-01-01 / Codex

## Outcomes & Retrospective

The missing server and game modules were restored in TypeScript, the timeline engine and public beat helper were added, and the server now supports WebSockets plus a snapshot endpoint. All tests pass (18 total). Remaining work is to manually exercise WebSocket input flow with a real client if desired.

## Context and Orientation

The entry point `src/index.ts` imports `buildServer` from `src/server.ts`, but that file is absent. Tests run against `dist/` and expect `public.beats` data structures with per-player beat entries containing fields like `username`, `action`, and `rotation`. The game logic modules in `src/game/` (action sets, card rules, beat timeline, execution, and state initialization) were deleted; compiled JavaScript versions exist under `dist/game/` and can be used as behavioral references. The browser UI expects a helper at `public/game/beatTimeline.js`, which is also missing.

In this plan, a beat is a timeline slot. A beat entry is the per-player row object inside `public.beats[beatIndex]`. The new Timeline type is a higher-level object that tracks `beats` and `currentBeatIndex` for server-side input prompting.

## Plan of Work

First, define the shared data models in `src/types.ts`, including the new abstract timeline types (Player, Character, Hand, Zones, Timeline, Beat, Trigger) and the legacy public state types (`public.beats`, characters, pending actions, and interactions). Update `src/types/node-shim.d.ts` with the minimal Node typings needed for WebSocket framing and server upgrade handlers. Next, restore the missing `src/game` modules by translating the behavior from `dist/` into TypeScript while keeping `public.beats` as the output shape expected by tests and UI, and implement a browser helper at `public/game/beatTimeline.js` so the front-end can compute earliest beats. Then add `src/game/timelineEngine.ts` to model input prompting, simultaneous input locks, and deterministic beat resolution hooks that can call existing rules modules. Finally, rebuild `src/server.ts` from the compiled reference, refactor it to use `public.beats`, add WebSocket broadcast/input handling, and expose a snapshot REST endpoint. Document the new message types and a sample beat resolution cycle in `docs/timeline-system.md`.

## Concrete Steps

Work in: `c:\Users\marce\OneDrive\Documents\GitHub\HexStrike`

    npm run build
    npm run test
    node dist/index.js

After the server starts, verify a snapshot:

    Invoke-WebRequest http://localhost:3000/api/v1/lobby/state

From a browser console, verify WebSocket connectivity:

    const ws = new WebSocket('ws://localhost:3000/ws?userId=demo');
    ws.onmessage = (ev) => console.log(ev.data);

## Validation and Acceptance

The build completes (`npm run build` via `cmd /c` when needed) and tests pass (`npm run test` shows 18 passing tests). The server prints `HexStrike lobby server listening on http://localhost:3000`. The lobby state endpoint responds with JSON containing queues. The snapshot endpoint returns a JSON object with `public.beats`. A WebSocket client receives a `connected` message on open and receives `game:update` and `input:request` messages when applicable.

## Idempotence and Recovery

All steps are additive and safe to re-run. If the WebSocket handshake fails, SSE remains available; re-run the server and confirm the upgrade headers were preserved in `src/server.ts`. If tests fail after regeneration, delete `dist/` and rebuild to ensure a clean compile output.

## Artifacts and Notes

Example input request message over WebSocket:

    { "type": "input:request", "payload": { "gameId": "<id>", "beatIndex": 3, "requiredUserIds": ["player-a"] } }

Example input submission message from a client:

    { "type": "input:submit", "payload": { "gameId": "<id>", "userId": "player-a", "activeCardId": "m-01", "passiveCardId": "a-05", "rotation": "R1" } }

## Interfaces and Dependencies

In `src/types.ts`, define the core data models and legacy public state shapes. Required exports include Player, Character, Hand, Zones, Timeline, Beat, Trigger, HexCoord, BeatEntry, PublicCharacter, GameStateDoc, PendingActions, CustomInteraction, DeckDefinition, DeckState, CardDefinition, CardCatalog, MatchDoc, GameDoc, UserDoc, QueueName, and LobbySnapshot.

In `src/game/state.ts`, define:

    export async function createInitialGameState(players: Array<{ userId: string; username: string; characterId: CharacterId }>): Promise<GameStateDoc>;

In `src/game/beatTimeline.ts`, define:

    export function getCharacterFirstEIndex(beats: BeatEntry[][], character: PublicCharacter): number;
    export function getTimelineEarliestEIndex(beats: BeatEntry[][], characters: PublicCharacter[]): number;
    export function isCharacterAtEarliestE(beats: BeatEntry[][], characters: PublicCharacter[], character?: PublicCharacter): boolean;
    export function getCharactersAtEarliestE(beats: BeatEntry[][], characters: PublicCharacter[]): PublicCharacter[];

In `src/game/actionSets.ts`, define:

    export function applyActionSetToBeats(beats: BeatEntry[][], characters: PublicCharacter[], targetUserId: string, actionList: ActionListItem[], play?: unknown[]): BeatEntry[][];

In `src/game/execute.ts`, define:

    export function executeBeats(beats: BeatEntry[][], characters: PublicCharacter[]): { beats: BeatEntry[][]; characters: PublicCharacter[]; lastCalculated: number; interactions: CustomInteraction[] };
    export function executeBeatsWithInteractions(beats: BeatEntry[][], characters: PublicCharacter[], interactions?: CustomInteraction[]): { beats: BeatEntry[][]; characters: PublicCharacter[]; lastCalculated: number; interactions: CustomInteraction[] };

In `src/game/cardCatalog.ts`, define:

    export async function loadCardCatalog(): Promise<CardCatalog>;

In `src/game/cardRules.ts`, define:

    export function parseDeckDefinition(deck: unknown, catalog: CardCatalog): { deck: DeckDefinition | null; errors: CardValidationError[] };
    export function buildDefaultDeckDefinition(catalog: CardCatalog): DeckDefinition;
    export function createDeckState(deck: DeckDefinition): DeckState;
    export function validateActionSubmission(submission: ActionSubmission, deckState: DeckState, catalog: CardCatalog): ActionValidationResult;
    export function applyCardUse(deckState: DeckState, cardUse: CardUse): { ok: true } | { ok: false; error: CardValidationError };
    export function buildPlayerCardState(deckState: DeckState): PlayerCardState;
    export function resolveLandRefreshes(deckStates: Map<string, DeckState>, beats: BeatEntry[][], characters: PublicCharacter[], land: HexCoord[], interactions?: CustomInteraction[]): void;
    export function getRefreshOffset(actions: string[]): number | null;
    export function isActionValidationFailure(result: ActionValidationResult): result is { ok: false; error: CardValidationError };

In `src/game/hexGrid.ts`, define:

    export function isLandHex(coord: HexCoord): boolean;
    export function getTerrain(coord: HexCoord): 'land' | 'abyss';
    export function buildDefaultLandHexes(): HexCoord[];

In `src/game/timelineEngine.ts`, define the abstract timeline system:

    export function createTimeline(beats: Beat[], currentBeatIndex?: number): Timeline;
    export function getInputTargets(beat: Beat, players: Player[]): string[];
    export function advanceTimeline(timeline: Timeline): Timeline;
    export function collectInput(timeline: Timeline, pending: PendingInputs, input: PlayerInput): PendingInputs;

In `src/server.ts`, implement `buildServer(port: number)` with SSE and WebSocket broadcasting, use `public.beats` for timeline state, and add a GET `/api/v1/game/:id/snapshot` endpoint. Message types must include `connected`, `queueChanged`, `match:created`, `game:update`, `match:ended`, `input:request`, `input:ack`, and `error`.

## Revision Notes

- 2026-01-01: Initial plan created to capture missing sources, expected data shapes, and the rebuilt timeline architecture scope.
- 2026-01-01: Updated progress, outcomes, and validation after implementing the rebuild and running tests.
