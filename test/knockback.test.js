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

test('hit applies knockback, clears timeline, and inserts damage icons', () => {
  const characters = [
    { userId: 'attacker', username: 'attacker', position: { q: -1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Attacker' },
    { userId: 'target', username: 'target', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Target' },
  ];

  const beats = [
    [
      buildEntry('attacker', 'a-a', 90, characters[0].position, characters[0].facing),
      buildEntry('target', 'm', 10, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('target', 'a', 20, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('target', 'm', 20, characters[1].position, characters[1].facing),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const beat1 = result.beats[1] || [];
  const beat2 = result.beats[2] || [];
  const target0 = beat0.find((entry) => entry.username === 'target');
  const target1 = beat1.find((entry) => entry.username === 'target');
  const target2 = beat2.find((entry) => entry.username === 'target');

  assert.ok(target0, 'target entry should exist at beat 0');
  assert.equal(target0.action, 'DamageIcon');
  assert.equal(target0.damage, 3);
  assert.deepEqual(target0.location, { q: 1, r: 0 });

  assert.ok(target1, 'target entry should exist at beat 1');
  assert.equal(target1.action, 'DamageIcon');

  assert.ok(target2, 'target entry should exist at beat 2');
  assert.equal(target2.action, 'E');
});
