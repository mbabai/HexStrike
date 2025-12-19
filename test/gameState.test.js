const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createInitialGameState } = require('../dist/game/state.js');

test('createInitialGameState seeds starting characters', async () => {
  const players = [
    { userId: 'player-a', characterId: 'murelious' },
    { userId: 'player-b', characterId: 'monkey-queen' },
  ];

  const state = await createInitialGameState(players);

  assert.equal(state.public.characters.length, 2);
  assert.deepEqual(state.public.characters[0], {
    userId: 'player-a',
    characterId: 'murelious',
    position: { q: 2, r: 0 },
    facing: 'left',
  });
  assert.deepEqual(state.public.characters[1], {
    userId: 'player-b',
    characterId: 'monkey-queen',
    position: { q: -2, r: 0 },
    facing: 'right',
  });
});
