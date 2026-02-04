const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { createDeckState, validateActionSubmission } = require('../dist/game/cardRules.js');
const { loadCardCatalog } = require('../dist/game/cardCatalog.js');

let catalog;

before(async () => {
  catalog = await loadCardCatalog();
});

const buildActionList = (activeCardId, passiveCardId, rotation = 'R1') => {
  const deckState = createDeckState({ movement: [passiveCardId], ability: [activeCardId] });
  const result = validateActionSubmission({ activeCardId, passiveCardId, rotation }, deckState, catalog);
  assert.equal(result.ok, true, result.ok ? '' : result.error?.message);
  return result.actionList;
};

test('counter-attack active shifts rotation to after the bracketed move', () => {
  const actionList = buildActionList('counter-attack', 'step', 'R1');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['[m]', 'a', 'W', 'W', 'E'],
  );
  assert.equal(actionList[0].rotation, '');
  assert.equal(actionList[0].rotationSource, 'selected');
  assert.equal(actionList[1].rotation, 'R1');
  assert.equal(actionList[1].rotationSource, 'forced');
});
