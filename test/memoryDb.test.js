const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MemoryDb } = require('../dist/persistence/memoryDb.js');

test('memory db upserts users and stores matches/games', async () => {
  const db = new MemoryDb();
  const alice = await db.upsertUser({ username: 'Alice' });
  assert.equal(alice.elo, 1000);

  const updated = await db.upsertUser({ username: 'Alice', elo: 1210 });
  assert.equal(updated.id, alice.id);
  assert.equal(updated.elo, 1210);

  const match = await db.createMatch({
    players: [
      { userId: alice.id, username: alice.username, score: 0, eloChange: 0 },
      { userId: 'bob', username: 'Bob', score: 0, eloChange: 0 },
    ],
    gameId: '',
    state: 'pending',
    winnerId: undefined,
    completedAt: undefined,
  });

  const game = await db.createGame({
    matchId: match.id,
    players: [
      { userId: alice.id, ready: true, turn: true },
      { userId: 'bob', ready: true, turn: false },
    ],
    timers: { turnSeconds: 60, incrementSeconds: 0 },
    outcome: undefined,
    state: {},
  });

  const matches = await db.listMatches();
  assert.equal(matches[0].id, match.id);

  const games = await db.listGames();
  assert.equal(games[0].id, game.id);
});
