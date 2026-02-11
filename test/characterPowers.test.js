const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDeckState, buildPlayerCardState } = require('../dist/game/cardRules.js');
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

test('createDeckState supports character max hand size overrides', () => {
  const deckState = createDeckState(
    {
      movement: ['step', 'dash', 'jump', 'advance'],
      ability: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'],
    },
    { baseMaxHandSize: 5 },
  );

  const playerCards = buildPlayerCardState(deckState);
  assert.equal(deckState.abilityHand.length, 5);
  assert.equal(deckState.abilityDeck.length, 1);
  assert.equal(playerCards.maxHandSize, 5);
});

test('Strylan attacks gain +1 damage', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', characterId: 'strylan', characterName: 'Strylan', position: { q: 0, r: 0 }, facing: 180 },
    { userId: 'beta', username: 'beta', characterId: 'murelious', characterName: 'Murelious', position: { q: 1, r: 0 }, facing: 180 },
  ];
  const beats = [[
    buildEntry('alpha', 'a', 50, characters[0].position, characters[0].facing, 2, 0),
    buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
  ]];

  const result = executeBeats(beats, characters);
  const beta = result.beats[0].find((entry) => entry.username === 'beta');

  assert.ok(beta);
  assert.equal(beta.damage, 3);
});

test('Monkey Queen no longer reduces incoming damage', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', characterId: 'murelious', characterName: 'Murelious', position: { q: 0, r: 0 }, facing: 180 },
    { userId: 'beta', username: 'beta', characterId: 'monkey-queen', characterName: 'Monkey Queen', position: { q: 1, r: 0 }, facing: 180 },
  ];
  const beats = [[
    buildEntry('alpha', 'a', 50, characters[0].position, characters[0].facing, 2, 0),
    buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
  ]];

  const result = executeBeats(beats, characters);
  const beta = result.beats[0].find((entry) => entry.username === 'beta');

  assert.ok(beta);
  assert.equal(beta.damage, 2);
});

test('Aumandetta draws 1 when hit with calculated knockback', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', characterId: 'murelious', characterName: 'Murelious', position: { q: 0, r: 0 }, facing: 180 },
    { userId: 'beta', username: 'beta', characterId: 'aumandetta', characterName: 'Aumandetta', position: { q: 1, r: 0 }, facing: 180 },
  ];
  const beats = [[
    buildEntry('alpha', 'a', 50, characters[0].position, characters[0].facing, 2, 1),
    buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
  ]];

  const result = executeBeats(beats, characters);
  const draw = result.interactions.find(
    (interaction) => interaction.type === 'draw' && interaction.actorUserId === 'beta',
  );

  assert.ok(draw);
  assert.equal(draw.drawCount, 1);
});

test('Zenytha reduces opponent discard effects by 1', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', characterId: 'murelious', characterName: 'Murelious', position: { q: 0, r: 0 }, facing: 180 },
    { userId: 'beta', username: 'beta', characterId: 'zenytha', characterName: 'Zenytha', position: { q: 1, r: 0 }, facing: 180 },
  ];
  const beats = [[
    buildEntry('alpha', '[a-La-Ra]', 50, characters[0].position, characters[0].facing, 0, 0),
    buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
  ]];
  beats[0][0].cardId = 'trip';

  const result = executeBeats(beats, characters);
  const discard = result.interactions.find(
    (interaction) => interaction.type === 'discard' && interaction.actorUserId === 'beta',
  );

  assert.ok(discard);
  assert.equal(discard.discardCount, 1);
});

test('Ryathan is immune to fire damage', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', characterId: 'ryathan', characterName: 'Ryathan', position: { q: 0, r: 0 }, facing: 180 },
    { userId: 'beta', username: 'beta', characterId: 'murelious', characterName: 'Murelious', position: { q: 1, r: 0 }, facing: 180 },
  ];
  const beats = [[
    buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
    buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
  ]];
  const initialTokens = [
    { id: 'fire-a', type: 'fire-hex', position: { q: 0, r: 0 }, facing: 0 },
    { id: 'fire-b', type: 'fire-hex', position: { q: 1, r: 0 }, facing: 0 },
  ];

  const result = executeBeats(beats, characters, undefined, initialTokens);
  const alpha = result.beats[0].find((entry) => entry.username === 'alpha');
  const beta = result.beats[0].find((entry) => entry.username === 'beta');

  assert.ok(alpha);
  assert.ok(beta);
  assert.equal(alpha.damage, 0);
  assert.equal(beta.damage, 1);
});

test('Monkey Queen gains knockback distance from accumulated damage', () => {
  const characters = [
    {
      userId: 'alpha',
      username: 'alpha',
      characterId: 'monkey-queen',
      characterName: 'Monkey Queen',
      position: { q: 0, r: 0 },
      facing: 180,
      damage: 10,
    },
    { userId: 'beta', username: 'beta', characterId: 'murelious', characterName: 'Murelious', position: { q: 1, r: 0 }, facing: 180 },
  ];
  const beats = [[
    buildEntry('alpha', 'a', 50, characters[0].position, characters[0].facing, 2, 1),
    buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
  ]];

  const result = executeBeats(beats, characters);
  const beta = result.beats[0].find((entry) => entry.username === 'beta');
  const consequence = beta?.consequences?.find((item) => item.type === 'hit');

  assert.ok(beta);
  assert.equal(beta.location.q, 3);
  assert.equal(consequence?.knockbackDistance, 2);
});
