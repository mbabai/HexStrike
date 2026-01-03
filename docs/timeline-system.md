# Timeline System Overview

HexStrike uses a server-authoritative timeline. The server owns the canonical game state, advances the timeline, requests player inputs when required, and resolves beats deterministically. Clients hold a mirrored, read-only view of public state and submit inputs when prompted.

## Data Model Summary

- Player: `{ id, username, characterId }`
- Character: `{ id, ownerPlayerId, hp, position, rotation }`
- Hand: `{ movementCards, abilityCards }` (up to 4 each)
- Zones: `{ deck, hand, discard }` (movement cards discard, ability cards recycle)
- Timeline: `{ beats, currentBeatIndex }`
- Beat: `{ index, playerId, action, text?, rotation?, priority?, triggers?, requiresInput }`
- Trigger: `{ type: 'require_input'|'reaction'|'interrupt', target: 'single_player'|'all_players' }`

The public state exposed to clients uses `public.beats` (an array of per-player beat entries) and `public.characters` for roster information. The server maps between the abstract `Timeline` and `public.beats` when prompting inputs or resolving action sets.

## Map and Terrain

The board is an infinite axial hex grid. Terrain is derived from coordinates:

- Land tiles are on rows `r = 0` for `q = -2..2`, `r = 1` for `q = -2..1`, and `r = -1` for `q = -1..2`.
- All other coordinates are abyss.

## Input Flow

1. Server advances the timeline to the next beat.
2. If `requiresInput` is true, the server sends `input:request` for the relevant players.
3. Players submit inputs (action sets or interaction responses).
4. Server validates inputs and resolves the beat deterministically.
5. Server updates game state and broadcasts incremental state updates.
6. Timeline advances to the next beat.

Simultaneous inputs are enforced by batching action sets for all required players at the earliest `E`.

## WebSocket Messages

All WebSocket messages use the envelope `{ type, payload, recipient }`. The recipient is populated by the server.

Server-to-client:
- `connected`: `{ userId, username, lobby }`
- `queueChanged`: lobby queue snapshot
- `match:created`: match document
- `game:update`: game document (public state + player cards)
- `match:ended`: match document
- `input:request`: `{ gameId, beatIndex, requiredUserIds, interactionId? }`
- `error`: `{ message, code? }`

Client-to-server:
- `input:submit`: `{ gameId, userId, activeCardId, passiveCardId, rotation }`
- `interaction:resolve`: `{ gameId, userId, interactionId, directionIndex }`

## Example Beat Resolution Cycle

1. Server sends:
   `{ "type": "input:request", "payload": { "gameId": "g1", "beatIndex": 3, "requiredUserIds": ["p1","p2"] } }`
2. Clients respond with:
   `{ "type": "input:submit", "payload": { "gameId": "g1", "userId": "p1", "activeCardId": "m-01", "passiveCardId": "a-05", "rotation": "R1" } }`
3. Once all required inputs arrive, the server resolves the beat and broadcasts:
   `{ "type": "game:update", "payload": { "state": { "public": { "beats": [...] } } } }`

## Snapshot Endpoint

Spectators or reconnecting clients can request a snapshot via:

`GET /api/v1/game/:id/snapshot`

The response includes `state.public.beats`, `state.public.characters`, and any pending inputs/interactions.
