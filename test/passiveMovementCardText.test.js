const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyPassiveMovementCardText } = require('../dist/game/cardText/passiveMovement.js');

const buildEntry = (action, patch = {}) => ({
  action,
  rotation: '',
  priority: 0,
  interaction: null,
  damage: 6,
  kbf: 2,
  cardId: 'mock-active',
  passiveCardId: 'mock-passive',
  ...patch,
});

test('fleche passive replaces the last W before the first exact {a} with a late m', () => {
  const activeCard = { id: 'mock-ability', type: 'ability' };
  const passiveCard = { id: 'fleche', type: 'movement' };

  const noExactA = [buildEntry('W'), buildEntry('2a'), buildEntry('W'), buildEntry('E')];
  const withWaitBeforeExactA = [buildEntry('W'), buildEntry('2a-a'), buildEntry('W'), buildEntry('E')];
  const noWaitBeforeAttack = [buildEntry('a'), buildEntry('W'), buildEntry('E')];

  const unchanged = applyPassiveMovementCardText(noExactA, activeCard, passiveCard, '0');
  const replaced = applyPassiveMovementCardText(withWaitBeforeExactA, activeCard, passiveCard, '0');
  const noWait = applyPassiveMovementCardText(noWaitBeforeAttack, activeCard, passiveCard, '0');

  assert.deepEqual(
    unchanged.map((entry) => entry.action),
    ['W', '2a', 'W', 'E'],
  );
  assert.deepEqual(
    replaced.map((entry) => entry.action),
    ['m', '2a-a', 'W', 'E'],
  );
  assert.deepEqual(replaced[0].timing, ['late']);
  assert.equal(replaced[0].priority, 20);
  assert.deepEqual(
    noWait.map((entry) => entry.action),
    ['a', 'W', 'E'],
  );
});

test('ninja roll passive only transforms exact {a} and [a] actions', () => {
  const activeCard = { id: 'mock-ability', type: 'ability' };
  const passiveCard = { id: 'ninja-roll', type: 'movement' };
  const actionList = [
    buildEntry('2a'),
    buildEntry('a'),
    buildEntry('[a]'),
    buildEntry('a-La-Ra'),
  ];

  const result = applyPassiveMovementCardText(actionList, activeCard, passiveCard, '0');

  assert.deepEqual(
    result.map((entry) => entry.action),
    ['2a', 'a-La-Ra', '[a-La-Ra]', 'a-La-Ra'],
  );
  assert.equal(result[0].damage, 6);
  assert.equal(result[0].kbf, 2);
  assert.equal(result[1].damage, 3);
  assert.equal(result[1].kbf, 1);
  assert.equal(result[2].damage, 3);
  assert.equal(result[2].kbf, 1);
  assert.equal(result[3].damage, 6);
  assert.equal(result[3].kbf, 2);
});
