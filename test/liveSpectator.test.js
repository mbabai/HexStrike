const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

process.env.NODE_ENV = 'production';
process.env.HEXSTRIKE_REQUIRE_MONGO_HISTORY = '0';
process.env.MONGODB_URI = '';
process.env.MONGODB_PROD_URI = '';

const { buildServer } = require('../dist/server.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildJsonClient = (baseUrl) => {
  const request = async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, options);
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  };

  const post = (path, body) =>
    request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });

  const get = (path) => request(path, { method: 'GET' });

  return { get, post };
};

const waitFor = async (getValue, predicate, options = {}) => {
  const timeoutMs = options.timeoutMs ?? 10000;
  const intervalMs = options.intervalMs ?? 75;
  const start = Date.now();
  let latest = null;
  while (Date.now() - start < timeoutMs) {
    latest = await getValue();
    if (predicate(latest)) return latest;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`);
};

const connectSse = async (baseUrl, userId) => {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/events?userId=${encodeURIComponent(userId)}`, {
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.ok(response.body, 'expected SSE response body');

  const reader = response.body.getReader();
  const events = [];
  let buffer = '';
  let closing = false;

  const pump = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += Buffer.from(value).toString('utf8');
        let separator = buffer.indexOf('\n\n');
        while (separator >= 0) {
          const frame = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          separator = buffer.indexOf('\n\n');
          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.replace(/^data:\s?/, ''))
            .join('\n');
          if (!data) continue;
          try {
            events.push(JSON.parse(data));
          } catch {
            // ignore malformed events
          }
        }
      }
    } catch (err) {
      if (!closing) throw err;
    }
  })();

  const waitForEvent = async (predicate, timeoutMs = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const index = events.findIndex((event) => predicate(event));
      if (index >= 0) {
        const [event] = events.splice(index, 1);
        return event;
      }
      await sleep(30);
    }
    throw new Error(`Timed out waiting for SSE event after ${timeoutMs}ms`);
  };

  const close = async () => {
    closing = true;
    controller.abort();
    try {
      await pump;
    } catch {
      // ignore abort noise
    }
  };

  return { waitForEvent, close };
};

test('spectator mode lists live games and streams spectator updates', async () => {
  const server = buildServer(0);
  await once(server, 'listening');
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const client = buildJsonClient(baseUrl);
  const playerOneId = `live-p1-${Date.now()}`;
  const playerTwoId = `live-p2-${Date.now()}`;
  const spectatorId = `live-spec-${Date.now()}`;
  let spectatorSse = null;

  try {
    const joinOne = await client.post('/api/v1/lobby/join', {
      userId: playerOneId,
      username: 'Live Player 1',
      queue: 'quickplay1v1Queue',
    });
    assert.equal(joinOne.response.status, 200);

    const joinTwo = await client.post('/api/v1/lobby/join', {
      userId: playerTwoId,
      username: 'Live Player 2',
      queue: 'quickplay1v1Queue',
    });
    assert.equal(joinTwo.response.status, 200);

    const match = await waitFor(
      async () => {
        const { response, payload } = await client.get('/api/v1/history/matches');
        assert.equal(response.status, 200);
        if (!Array.isArray(payload)) return null;
        return (
          payload.find((candidate) => {
            const players = Array.isArray(candidate?.players) ? candidate.players : [];
            const userIds = new Set(players.map((player) => player?.userId));
            return userIds.has(playerOneId) && userIds.has(playerTwoId) && candidate?.gameId;
          }) ?? null
        );
      },
      (value) => Boolean(value),
      { timeoutMs: 12000 },
    );

    const gameId = `${match.gameId}`;
    assert.ok(gameId, 'expected active game id');

    const liveGames = await waitFor(
      async () => {
        const { response, payload } = await client.get('/api/v1/history/live-games');
        assert.equal(response.status, 200);
        return payload;
      },
      (payload) =>
        Array.isArray(payload) &&
        payload.some((game) => `${game?.id ?? game?.sourceGameId ?? ''}` === gameId),
      { timeoutMs: 12000 },
    );
    assert.ok(Array.isArray(liveGames), 'expected live games list');

    spectatorSse = await connectSse(baseUrl, spectatorId);
    await spectatorSse.waitForEvent(
      (event) => event?.type === 'connected' && `${event?.payload?.userId ?? ''}` === spectatorId,
      8000,
    );

    const watch = await client.post('/api/v1/history/live-games/watch', {
      userId: spectatorId,
      gameId,
    });
    assert.equal(watch.response.status, 200);
    assert.equal(`${watch.payload?.sourceGameId ?? ''}`, gameId);
    assert.ok(watch.payload?.state?.public, 'expected live game state in watch payload');

    const forfeit = await client.post('/api/v1/game/forfeit', {
      userId: playerOneId,
      gameId,
    });
    assert.equal(forfeit.response.status, 200);

    const spectatorUpdate = await spectatorSse.waitForEvent(
      (event) =>
        event?.type === 'spectator:update' &&
        `${event?.payload?.sourceGameId ?? ''}` === gameId &&
        Boolean(event?.payload?.state?.public?.matchOutcome),
      12000,
    );
    assert.equal(spectatorUpdate.payload.state.public.matchOutcome.reason, 'forfeit');
  } finally {
    if (spectatorSse) {
      await spectatorSse.close();
    }
    await new Promise((resolve) => server.close(resolve));
  }
});
