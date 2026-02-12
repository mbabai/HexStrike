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

test('counter-attack active leaves rotation on the start action', () => {
  const actionList = buildActionList('counter-attack', 'step', 'R1');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['Bm', 'a', 'W', 'E'],
  );
  assert.equal(actionList[0].rotation, 'R1');
  assert.equal(actionList[0].rotationSource, 'selected');
  assert.equal(actionList[1].rotation, '');
  assert.equal(actionList[1].rotationSource, undefined);
});

test('aerial-strike active forces a 3 rotation after the jump without clearing the start rotation', () => {
  const actionList = buildActionList('aerial-strike', 'step', 'R2');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['W', '[2j]', 'a', 'W', 'W', 'W', 'E'],
  );
  assert.equal(actionList[0].rotation, 'R2');
  assert.equal(actionList[0].rotationSource, 'selected');
  assert.equal(actionList[2].rotation, '3');
  assert.equal(actionList[2].rotationSource, 'forced');
});

test('whirlwind active sets KBF to 3 on the bracketed action', () => {
  const actionList = buildActionList('whirlwind', 'step', 'R1');
  const bracketIndex = actionList.findIndex((entry) => entry.action.startsWith('['));
  assert.notEqual(bracketIndex, -1);
  assert.equal(actionList[bracketIndex].kbf, 3);
});

test('smoke-bomb active swaps into the passive action list at X1 with selected rotation', () => {
  const actionList = buildActionList('smoke-bomb', 'step', 'R2');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['W', '[a-La-Ra]', 'W', 'Bm', 'W', 'E'],
  );
  assert.equal(actionList[0].rotation, '');
  assert.equal(actionList[0].rotationSource, undefined);
  assert.equal(actionList[2].rotation, 'R2');
  assert.equal(actionList[2].rotationSource, 'selected');
  assert.equal(actionList[2].cardId, 'step');
  assert.equal(actionList[2].passiveCardId, 'smoke-bomb');
});
