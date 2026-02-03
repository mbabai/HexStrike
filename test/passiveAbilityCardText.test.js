const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { createDeckState, validateActionSubmission } = require('../dist/game/cardRules.js');
const { loadCardCatalog } = require('../dist/game/cardCatalog.js');

let catalog;

before(async () => {
  catalog = await loadCardCatalog();
});

const buildActionList = (activeCardId, passiveCardId, rotation = '0') => {
  const deckState = createDeckState({ movement: [activeCardId], ability: [passiveCardId] });
  const result = validateActionSubmission({ activeCardId, passiveCardId, rotation }, deckState, catalog);
  assert.equal(result.ok, true, result.ok ? '' : result.error?.message);
  return result.actionList;
};

test('chase passive adds a leading wait and upgrades m to 2m', () => {
  const actionList = buildActionList('step', 'chase');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['W', 'W', '2m', 'W', 'E'],
  );
  assert.equal(actionList[0].rotation, '0');
  assert.equal(actionList[1].rotation, '');
});

test('cross-slash passive replaces m with m-La-Ra and sets damage/KBF', () => {
  const actionList = buildActionList('step', 'cross-slash');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['W', 'm-La-Ra', 'W', 'E'],
  );
  assert.equal(actionList[1].damage, 2);
  assert.equal(actionList[1].kbf, 1);
});

test('flying-knee passive converts movement to charges with 1 damage/kbf', () => {
  const actionList = buildActionList('dash', 'flying-knee');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['2c', 'W', 'W', 'W', 'W', 'E'],
  );
  assert.equal(actionList[0].damage, 1);
  assert.equal(actionList[0].kbf, 1);
});

test('flying-knee passive converts backward movement to backward charges', () => {
  const actionList = buildActionList('backflip', 'flying-knee');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['Bc', 'W', 'W', 'W', 'E'],
  );
  assert.equal(actionList[0].damage, 1);
  assert.equal(actionList[0].kbf, 1);
});

test('smash-attack passive inserts the follow-up attack after a jump', () => {
  const actionList = buildActionList('leap', 'smash-attack');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['W', 'W', '3j', 'a-La-Ra-BLa-BRa-Ba', 'W', 'W', 'W', 'W', 'E'],
  );
  assert.equal(actionList[3].damage, 1);
  assert.equal(actionList[3].kbf, 1);
});

test('push-kick passive converts jumps to backward jumps', () => {
  const actionList = buildActionList('leap', 'push-kick');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['W', 'W', 'B3j', 'W', 'W', 'W', 'W', 'E'],
  );
});

test('push-kick passive converts movement to backward movement', () => {
  const actionList = buildActionList('dash', 'push-kick');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['B2m', 'W', 'W', 'W', 'W', 'E'],
  );
});

test('smoke-bomb passive inverts movement direction', () => {
  const forward = buildActionList('dash', 'smoke-bomb');
  assert.deepEqual(
    forward.map((entry) => entry.action),
    ['B2m', 'W', 'W', 'W', 'W', 'E'],
  );
  const backward = buildActionList('backflip', 'smoke-bomb');
  assert.deepEqual(
    backward.map((entry) => entry.action),
    ['m', 'W', 'W', 'W', 'E'],
  );
});

test('jab passive increases priority across the action list', () => {
  const basePriority = catalog.cardsById.get('step').priority;
  const actionList = buildActionList('step', 'jab');
  actionList.forEach((entry) => {
    assert.equal(entry.priority, basePriority + 30);
  });
});

test('whirlwind passive replaces the final m with c-La-Ra-BLa-BRa-Ba', () => {
  const actionList = buildActionList('advance', 'whirlwind');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['W', 'm', 'c-La-Ra-BLa-BRa-Ba', 'W', 'E'],
  );
  assert.equal(actionList[2].damage, 1);
  assert.equal(actionList[2].kbf, 0);
});
