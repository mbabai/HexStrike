const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { createDeckState, validateActionSubmission } = require('../dist/game/cardRules.js');
const { loadCardCatalog } = require('../dist/game/cardCatalog.js');

let catalog;

before(async () => {
  catalog = await loadCardCatalog();
});

const buildActionList = (activeCardId, passiveCardId, rotation = 'R1', adrenaline = 0) => {
  const deckState = createDeckState({ movement: [passiveCardId], ability: [activeCardId] });
  const submission = { activeCardId, passiveCardId, rotation };
  if (Number.isFinite(adrenaline) && adrenaline > 0) {
    submission.adrenaline = adrenaline;
  }
  const result = validateActionSubmission(submission, deckState, catalog);
  assert.equal(result.ok, true, result.ok ? '' : result.error?.message);
  return result.actionList;
};

test('counter-attack active leaves rotation on the start action', () => {
  const actionList = buildActionList('counter-attack', 'step', 'R1');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['[Bm]', 'a', 'W', 'E'],
  );
  assert.equal(actionList[0].rotation, 'R1');
  assert.equal(actionList[0].rotationSource, 'selected');
  assert.equal(actionList[1].rotation, '');
  assert.equal(actionList[1].rotationSource, undefined);
});

test('counter-attack active applies submitted-adrenaline timing thresholds only to beat 1', () => {
  const baseActionList = buildActionList('counter-attack', 'step', 'R1');
  const midActionList = buildActionList('counter-attack', 'step', 'R1', 5);
  const earlyActionList = buildActionList('counter-attack', 'step', 'R1', 10);

  assert.deepEqual(baseActionList[0].timing, ['late']);
  assert.deepEqual(midActionList[0].timing, ['mid']);
  assert.deepEqual(earlyActionList[0].timing, ['early']);
  assert.deepEqual(baseActionList[1].timing, ['early']);
  assert.deepEqual(midActionList[1].timing, ['early']);
  assert.deepEqual(earlyActionList[1].timing, ['early']);
});

test('cross-slash active adds KBF at Adr6', () => {
  const baseActionList = buildActionList('cross-slash', 'step', 'R1');
  const boostedActionList = buildActionList('cross-slash', 'step', 'R1', 6);

  assert.equal(baseActionList[1].kbf, 2);
  assert.equal(boostedActionList[1].kbf, 3);
});

test('flying-knee active applies Adr3 damage and KBF changes on the bracketed charge', () => {
  const baseActionList = buildActionList('flying-knee', 'step', 'R1');
  const boostedActionList = buildActionList('flying-knee', 'step', 'R1', 3);

  assert.equal(baseActionList[1].damage, 2);
  assert.equal(baseActionList[1].kbf, 2);
  assert.equal(boostedActionList[1].damage, 6);
  assert.equal(boostedActionList[1].kbf, 1);
});

test('fumikomi active adds KBF at Adr6', () => {
  const baseActionList = buildActionList('fumikomi', 'step', 'R1');
  const boostedActionList = buildActionList('fumikomi', 'step', 'R1', 6);

  assert.equal(baseActionList[1].kbf, 1);
  assert.equal(boostedActionList[1].kbf, 3);
});

test('spinning-back-kick active changes the bracketed action to Bc at Adr4', () => {
  const baseActionList = buildActionList('spinning-back-kick', 'step', 'R1');
  const boostedActionList = buildActionList('spinning-back-kick', 'step', 'R1', 4);

  assert.equal(baseActionList[0].action, '[Ba-BLa-BRa]');
  assert.equal(boostedActionList[0].action, '[Bc]');
});

test('aerial-strike active forces a 3 rotation after the jump without clearing the start rotation', () => {
  const actionList = buildActionList('aerial-strike', 'step', 'R2');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['W', '[2j]', 'a', 'W', 'W', 'E'],
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
    ['W', '[a-La-Ra]', 'W', 'Bm', 'E'],
  );
  assert.equal(actionList[0].rotation, '');
  assert.equal(actionList[0].rotationSource, undefined);
  assert.equal(actionList[2].rotation, 'R2');
  assert.equal(actionList[2].rotationSource, 'selected');
  assert.equal(actionList[2].cardId, 'step');
  assert.equal(actionList[2].passiveCardId, 'smoke-bomb');
});
