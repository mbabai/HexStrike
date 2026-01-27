const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executeBeats } = require('../dist/game/execute.js');

const buildEntry = (username, action, priority, position, facing, rotation = '', attackDamage = 0, attackKbf = 0) => ({
  username,
  action,
  rotation,
  priority,
  damage: 0,
  location: { q: position.q, r: position.r },
  facing,
  calculated: false,
  attackDamage,
  attackKbf,
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

test('executeBeats applies rotations before action resolution even when disabled', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', '1a', 20, characters[0].position, characters[0].facing, '', 2, 0),
      buildEntry('beta', '1m', 0, characters[1].position, characters[1].facing, 'R1', 0, 0),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const betaEntry = beat0.find((entry) => entry.username === 'beta');

  assert.ok(betaEntry);
  assert.equal(betaEntry.location.q, 1);
  assert.equal(betaEntry.location.r, 0);
  assert.equal(betaEntry.facing, 240);
});

test('executeBeats skips combo choice on missed attacks and keeps Co symbol', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 3, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', '1a', 20, characters[0].position, characters[0].facing, '', 2, 0),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'Co', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat1 = result.beats[1] || [];
  const alphaEntry = beat1.find((entry) => entry.username === 'alpha');

  assert.ok(alphaEntry);
  assert.equal(alphaEntry.action, 'Co');
  assert.equal(alphaEntry.comboSkipped, true);
  assert.equal(result.interactions.some((interaction) => interaction.type === 'combo'), false);
});

test('executeBeats does not open combo on throw hits', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', '[a]', 20, characters[0].position, characters[0].facing, '', 2, 0),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'Co', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  beats[0][0].interaction = { type: 'throw' };
  beats[0][0].cardId = 'throw-card';
  beats[1][0].cardId = 'throw-card';

  const result = executeBeats(beats, characters);
  assert.equal(result.interactions.some((interaction) => interaction.type === 'combo'), false);
});

test('executeBeats preserves action when hit after acting and records consequences', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', '1a', 5, characters[1].position, characters[1].facing, '', 2, 1),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const alphaEntry = beat0.find((entry) => entry.username === 'alpha');

  assert.ok(alphaEntry);
  assert.equal(alphaEntry.action, 'W');
  assert.ok(Array.isArray(alphaEntry.consequences));
  assert.deepEqual(alphaEntry.consequences[0], { type: 'hit', damageDelta: 2, knockbackDistance: 1 });

  const beat1 = result.beats[1] || [];
  const alphaBeat1 = beat1.find((entry) => entry.username === 'alpha');
  assert.ok(alphaBeat1);
  assert.equal(alphaBeat1.action, 'DamageIcon');
});

test('executeBeats preserves rotations when hit overrides the action', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', '1a', 20, characters[0].position, characters[0].facing, '', 2, 1),
      buildEntry('beta', '1m', 0, characters[1].position, characters[1].facing, 'R1', 0, 0),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const betaEntry = beat0.find((entry) => entry.username === 'beta');

  assert.ok(betaEntry);
  assert.equal(betaEntry.action, 'DamageIcon');
  assert.equal(betaEntry.rotation, 'R1');
  assert.equal(betaEntry.facing, 240);
});
