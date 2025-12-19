const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createInitialGameState } = require('../dist/game/state.js');

test('createInitialGameState seeds starting characters', async () => {
  const players = [
    { userId: 'player-a', username: 'Player A', characterId: 'murelious' },
    { userId: 'player-b', username: 'Player B', characterId: 'monkey-queen' },
  ];

  const state = await createInitialGameState(players);

  assert.equal(state.public.characters.length, 2);
  assert.equal(state.public.beats.length, 1);
  assert.deepEqual(state.public.beats[0], [
    { username: 'Player A', action: 'E', rotation: '', priority: 0, damage: 0, location: { q: 2, r: 0 } },
    { username: 'Player B', action: 'E', rotation: '', priority: 0, damage: 0, location: { q: -2, r: 0 } },
  ]);
  assert.deepEqual(state.public.characters[0], {
    userId: 'player-a',
    username: 'Player A',
    characterId: 'murelious',
    characterName: 'Murelious',
    position: { q: 2, r: 0 },
    facing: 'left',
  });
  assert.deepEqual(state.public.characters[1], {
    userId: 'player-b',
    username: 'Player B',
    characterId: 'monkey-queen',
    characterName: 'Monkey Queen',
    position: { q: -2, r: 0 },
    facing: 'right',
  });
});
