# HexStrike Lobby Server

HexStrike is a dependency-light Node.js lobby and matchmaking prototype with a browser UI, HTTP API, and Server-Sent Events (SSE) stream.

## Requirements
- Node.js `24.x` (LTS) and npm

## Quick start
1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the server:
   ```bash
   npm run build
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open the lobby UI at `http://localhost:3000`.

Set `PORT` to change the server port.

## Environment
The server loads `.env` automatically when present.

- `NODE_ENV` (`development` or `production`)
- `PORT`
- `APP_BASE_URL` (used for absolute share links)
- `MONGODB_LOCAL_URI` (used when `NODE_ENV !== production`)
- `MONGODB_PROD_URI` (used when `NODE_ENV === production`)
- `MONGODB_URI` (global override; used in any environment when set)
- `MONGODB_DB_NAME` (default `HexStrike`)
- `MONGODB_GAMES_COLLECTION` (default `games`)
- `HEXSTRIKE_REQUIRE_MONGO_HISTORY` (`true/false`, defaults to `true` on hosted/production runtimes and `false` locally)

Production URI fallback keys are also supported:
- `MONGODB_ATLAS_CONNECTION_STRING`
- `MONGODB_ATLAS_URI`
- `MONGODB_URI`
- `MongoDB-Atlas-ConnectionString`

### Azure Key Vault reuse (App Service)
If you already have `MongoDB-Atlas-ConnectionString` in Key Vault, easiest path:
1. Enable System Assigned Identity on your App Service.
2. Grant that identity Key Vault secret read permissions (`Get`, optionally `List`) on `byMarcellKeyVault`.
3. In App Service Configuration, add either:
   - `MONGODB_PROD_URI = @Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/MongoDB-Atlas-ConnectionString/)`
   - or `MongoDB-Atlas-ConnectionString = @Microsoft.KeyVault(...)` (the server now supports this name directly).
4. Set `NODE_ENV=production` and `APP_BASE_URL=https://<your-app-domain>`.
5. Restart the app.

## Development
`npm run dev` builds, runs tests, then starts the server with auto-reload. If tests fail, the server will not start.

When started with `npm run dev` (or `npm run dev:watch`), server diagnostics are written to `temp-logs/`:
- `temp-logs/server.log` mirrors server console output.
- `temp-logs/events.jsonl` stores structured `action-set` / `interaction-resolve` snapshots (including before/after timeline state).

`temp-logs/` is reset each time the dev server process starts.

If you want TypeScript to rebuild on every change, run this in another terminal:
```bash
npm run build -- --watch
```

## Tests
Run the Node.js test suite with:
```bash
npm run test
```

Check Mongo history connectivity/target selection explicitly with:
```bash
npm run test:history-store
```
This prints JSON diagnostics (`mode`, `dbName`, `collectionName`, URI source/route) and exits non-zero when Mongo is required but unavailable.

## Using the lobby UI
- Select **Quickplay**, **Strike-bot (Hard)**, **Hex-bot (Medium)**, or **Bot-bot (Easy)**, then click **Find Game** to start queue search; the timer counts up while searching.
- Clicking **Find Game** again cancels the search and leaves the queue.
- Bot queues start an immediate 1v1 match against the selected bot difficulty, each using a random base deck.
- Sidebar links are stubs and show "Coming soon".

## Character powers
- Character powers are defined in `public/characters/characters.json`.
- Deck creation shows each character's power text in the character picker.
- In-game board token hover tooltips show the selected character's power text.
- Server resolution reads effects via `src/game/characterPowers.ts`; client playback mirrors power effects in `public/game/timelinePlayback.js`.

## API quick reference
- `GET /events?userId=...` - SSE stream (server will assign an ID if omitted).
- `POST /api/v1/lobby/join` - `{ userId, username, queue }` (queues: `quickplayQueue`, `rankedQueue`, `botHardQueue`, `botMediumQueue`, `botEasyQueue`, legacy `botQueue`)
- `POST /api/v1/lobby/leave` - `{ userId, queue }`
- `POST /api/v1/lobby/clear` - `{}`
- `POST /api/v1/match/custom` - `{ hostId, hostName, guestId, guestName }`
- `POST /api/v1/match/:matchId/end` - `{ winnerId }`
- `POST /api/v1/match/:matchId/exit` - `{ userId }`
- `POST /api/v1/game/action-set` - `{ userId, gameId, activeCardId, passiveCardId, rotation }`
- `POST /api/v1/game/interaction` - `{ userId, gameId, interactionId, ...resolutionFields }`
- `POST /api/v1/game/forfeit` - `{ userId, gameId }`
- `POST /api/v1/game/draw-offer` - `{ userId, gameId }` (30-second server cooldown per offerer)
- `GET /api/v1/history/matches`
- `GET /api/v1/history/status` - reports active history persistence mode (`mongo` vs `memory`) and selected URI source (`ok=false` with `error` when unavailable)
- `GET /api/v1/history/games` - list persisted game history entries
- `GET /api/v1/history/games/:id` - load a specific replayable game history entry
- `POST /api/v1/history/games/share` - `{ userId, gameId }` -> returns share link

## Notes
- Users, lobbies, active matches, and active games are in memory and reset on restart.
- Completed game history is persisted to MongoDB (`HexStrike.games`) when Mongo is reachable.
- In hosted/production runtimes, history storage requires Mongo by default and the server exits on startup if Mongo is unavailable (set `HEXSTRIKE_REQUIRE_MONGO_HISTORY=false` to allow fallback).
