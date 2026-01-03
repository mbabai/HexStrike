const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executeBeats } = require('../dist/game/execute.js');

const buildEntry = (username, action, priority, position, facing) => ({
  username,
  action,
  rotation: '',
  priority,
  damage: 0,
  location: { q: position.q, r: position.r },
  facing,
  calculated: false,
});

test('executeBeats does not inject placeholder entries for missing characters', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];

  assert.equal(beat0.length, 1);
  assert.ok(beat0.find((entry) => entry.username === 'alpha'));
  assert.equal(beat0.some((entry) => entry.username === 'beta'), false);
});
