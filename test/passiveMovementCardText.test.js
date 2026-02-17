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

test('fleche passive only counts exact {a} tokens before the final W', () => {
  const activeCard = { id: 'mock-ability', type: 'ability' };
  const passiveCard = { id: 'fleche', type: 'movement' };

  const noExactA = [buildEntry('W'), buildEntry('2a'), buildEntry('W'), buildEntry('E')];
  const withExactAInMultiToken = [buildEntry('W'), buildEntry('2a-a'), buildEntry('W'), buildEntry('E')];

  const unchanged = applyPassiveMovementCardText(noExactA, activeCard, passiveCard, '0');
  const trimmed = applyPassiveMovementCardText(withExactAInMultiToken, activeCard, passiveCard, '0');

  assert.deepEqual(
    unchanged.map((entry) => entry.action),
    ['W', '2a', 'W', 'E'],
  );
  assert.deepEqual(
    trimmed.map((entry) => entry.action),
    ['W', '2a-a', 'E'],
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
