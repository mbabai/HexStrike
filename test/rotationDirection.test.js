const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executeBeats } = require('../dist/game/execute.js');

const buildEntry = (username, action, rotation, position, facing) => ({
  username,
  action,
  rotation,
  priority: 0,
  damage: 0,
  location: { q: position.q, r: position.r },
  facing,
  calculated: false,
});

test('rotation directions map L/R to the expected facing delta', () => {
  const characters = [
    { userId: 'rotator', username: 'rotator', position: { q: 0, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Rotator' },
  ];

  const rightResult = executeBeats(
    [[buildEntry('rotator', 'W', 'R1', characters[0].position, characters[0].facing)]],
    characters,
  );
  const leftResult = executeBeats(
    [[buildEntry('rotator', 'W', 'L1', characters[0].position, characters[0].facing)]],
    characters,
  );

  const rightBeat = rightResult.beats[0]?.[0];
  const leftBeat = leftResult.beats[0]?.[0];

  assert.ok(rightBeat, 'right beat entry should exist');
  assert.ok(leftBeat, 'left beat entry should exist');
  assert.equal(rightBeat.facing, 60);
  assert.equal(leftBeat.facing, 300);
});
