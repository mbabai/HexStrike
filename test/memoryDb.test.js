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
      { userId: alice.id, username: alice.username, score: 0, eloChange: 0, characterId: 'murelious' },
      { userId: 'bob', username: 'Bob', score: 0, eloChange: 0, characterId: 'monkey-queen' },
    ],
    gameId: '',
    winsRequired: 3,
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

  const activeMatch = await db.findActiveMatchByUser(alice.id);
  assert.equal(activeMatch.id, match.id);

  const storedGame = await db.findGame(game.id);
  assert.equal(storedGame.id, game.id);
});

test('memory db upserts by id without merging on username collisions', async () => {
  const db = new MemoryDb();
  const alpha = await db.upsertUser({ id: 'alpha-id', username: 'alpha' });
  const beta = await db.upsertUser({ id: 'beta-id', username: 'beta' });

  const renamed = await db.upsertUser({ id: alpha.id, username: beta.username });
  assert.equal(renamed.id, alpha.id);
  assert.equal(renamed.username, beta.username);

  const users = await db.listUsers();
  assert.equal(users.length, 2);
  assert.equal(users.find((user) => user.id === alpha.id)?.username, beta.username);
  assert.equal(users.find((user) => user.id === beta.id)?.username, beta.username);
});

test('memory db stores and retrieves replays', async () => {
  const db = new MemoryDb();
  const replay = await db.createReplay({
    sourceGameId: 'game-1',
    sourceMatchId: 'match-1',
    players: [
      { userId: 'u1', username: 'Alice', characterId: 'murelious', characterName: 'Murelious' },
      { userId: 'u2', username: 'Bob', characterId: 'strylan', characterName: 'Strylan' },
    ],
    state: {
      public: {
        land: [],
        beats: [],
        timeline: [],
        characters: [],
        customInteractions: [],
      },
    },
  });

  const byId = await db.findReplay(replay.id);
  assert.equal(byId?.id, replay.id);

  const byGameId = await db.findReplayByGameId('game-1');
  assert.equal(byGameId?.id, replay.id);

  const list = await db.listReplays();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, replay.id);
});
