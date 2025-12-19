# HexStrike Lobby Server

HexStrike is a dependency-light Node.js lobby and matchmaking prototype with a browser UI, HTTP API, and Server-Sent Events (SSE) stream.

## Requirements
- Node.js (18+ for `node --watch` and `node --test`) and npm

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

## Development
`npm run dev` builds, runs tests, then starts the server with auto-reload. If tests fail, the server will not start.

If you want TypeScript to rebuild on every change, run this in another terminal:
```bash
npm run build -- --watch
```

## Tests
Run the Node.js test suite with:
```bash
npm run test
```

## Using the lobby UI
- Click **Find Game** to toggle Quickplay queue search; the timer counts up while searching.
- Clicking **Find Game** again cancels the search and leaves the queue.
- The queue selector is a placeholder for future modes; non-Quickplay queues show an alert.
- Sidebar links are stubs and show "Coming soon".

## API quick reference
- `GET /events?userId=...` - SSE stream (server will assign an ID if omitted).
- `POST /api/v1/lobby/join` - `{ userId, username, queue }` (queues: `quickplayQueue`, `rankedQueue`, `botQueue`)
- `POST /api/v1/lobby/leave` - `{ userId, queue }`
- `POST /api/v1/lobby/clear` - `{}`
- `POST /api/v1/match/custom` - `{ hostId, hostName, guestId, guestName }`
- `POST /api/v1/match/:matchId/end` - `{ winnerId }`
- `POST /api/v1/game/action-set` - `{ userId, gameId, actionList }`
- `GET /api/v1/history/matches`
- `GET /api/v1/history/games`

## Notes
- Data is stored in memory only; restarting the server resets users, matches, and games.
