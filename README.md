# HexStrike Lobby Server

HexStrike is a Node.js lobby and matchmaking skeleton with a browser UI and a server-sent events stream.

## Requirements
- Node.js and npm

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
Run the TypeScript compiler in watch mode, then start the server with auto-reload:
```bash
npm run build -- --watch
npm run dev
```

## Using the lobby UI
- Click **Connect** to open the SSE stream.
- Set **User ID** and **Username** to control your identity.
- Join or leave queues (valid queues: `quickplayQueue`, `rankedQueue`, `botQueue`).
- Create a custom match by entering opponent details.
- Watch the **Lobby Snapshot** and **Event Log** panes for updates.

## API quick reference
- `GET /events?userId=...` - SSE stream (server will assign an ID if omitted).
- `POST /api/v1/lobby/join` - `{ userId, username, queue }`
- `POST /api/v1/lobby/leave` - `{ userId, queue }`
- `POST /api/v1/lobby/clear` - `{}`
- `POST /api/v1/match/custom` - `{ hostId, hostName, guestId, guestName }`
- `POST /api/v1/match/:matchId/end` - `{ winnerId }`
- `GET /api/v1/history/matches`
- `GET /api/v1/history/games`

## Notes
- Data is stored in memory only; restarting the server resets users, matches, and games.
