const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executeBeats } = require('../dist/game/execute.js');

const buildEntry = (username, action, priority, position, facing, attackDamage = 0, attackKbf = 0) => ({
  username,
  action,
  rotation: '',
  priority,
  damage: 0,
  location: { q: position.q, r: position.r },
  facing,
  calculated: false,
  attackDamage,
  attackKbf,
});

test('block stops attacks coming from the facing side', () => {
  const characters = [
    { userId: 'blocker', username: 'blocker', position: { q: 0, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Blocker' },
    { userId: 'attacker', username: 'attacker', position: { q: -1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Attacker' },
  ];

  const beats = [
    [
      buildEntry('blocker', 'b', 99, characters[0].position, characters[0].facing),
      buildEntry('attacker', 'a', 90, characters[1].position, characters[1].facing, 3, 1),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat = result.beats[0] || [];
  const blocker = beat.find((entry) => entry.username === 'blocker');

  assert.ok(blocker, 'blocker entry should exist');
  assert.equal(blocker.damage, 0);
});

test('block does not protect against attacks from the opposite side', () => {
  const characters = [
    { userId: 'blocker', username: 'blocker', position: { q: 0, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Blocker' },
    { userId: 'attacker', username: 'attacker', position: { q: 1, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Attacker' },
  ];

  const beats = [
    [
      buildEntry('blocker', 'b', 99, characters[0].position, characters[0].facing),
      buildEntry('attacker', 'a', 90, characters[1].position, characters[1].facing, 3, 1),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat = result.beats[0] || [];
  const blocker = beat.find((entry) => entry.username === 'blocker');

  assert.ok(blocker, 'blocker entry should exist');
  assert.equal(blocker.damage, 3);
});
