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
    ['W', 'W', '2m', 'E'],
  );
  assert.equal(actionList[0].rotation, '0');
  assert.equal(actionList[1].rotation, '');
});

test('aerial-strike passive forces rotation after the final movement entry', () => {
  const actionList = buildActionList('advance', 'aerial-strike');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['W', 'm', 'm', 'E'],
  );
  assert.equal(actionList[3].rotation, '3');
  assert.equal(actionList[3].rotationSource, 'forced');
});

test('aerial-strike passive treats charge movement as movement for final rotate 3', () => {
  const actionList = buildActionList('grappling-hook', 'aerial-strike');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['W', 'W', '[3c]', 'W', 'E'],
  );
  assert.equal(actionList[3].rotation, '3');
  assert.equal(actionList[3].rotationSource, 'forced');
});

test('cross-slash passive replaces m with m-La-Ra and sets damage/KBF', () => {
  const actionList = buildActionList('step', 'cross-slash');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['W', 'm-La-Ra', 'E'],
  );
  assert.equal(actionList[1].damage, 2);
  assert.equal(actionList[1].kbf, 1);
});

test('counter-attack passive converts first m to m-Ba with damage/KBF 2', () => {
  const actionList = buildActionList('step', 'counter-attack');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['W', 'm-Ba', 'E'],
  );
  assert.equal(actionList[1].damage, 2);
  assert.equal(actionList[1].kbf, 2);
});

test('flying-knee passive converts movement to charges with 1 damage/kbf', () => {
  const actionList = buildActionList('dash', 'flying-knee');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['2c', 'W', 'W', 'E'],
  );
  assert.equal(actionList[0].damage, 1);
  assert.equal(actionList[0].kbf, 1);
});

test('flying-knee passive converts backward movement to backward charges', () => {
  const actionList = buildActionList('backflip', 'flying-knee');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['Bc', 'W', 'E'],
  );
  assert.equal(actionList[0].damage, 1);
  assert.equal(actionList[0].kbf, 1);
});

test('smash-attack passive inserts the follow-up attack after a jump', () => {
  const actionList = buildActionList('leap', 'smash-attack');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['Adr+1', '3j', 'a-La-Ra-BLa-BRa-Ba', 'W', 'W', 'E'],
  );
  assert.equal(actionList[2].damage, 1);
  assert.equal(actionList[2].kbf, 1);
  assert.deepEqual(actionList[2].timing, ['early']);
  assert.equal(actionList[2].priority, 100);
});

test('push-kick has no passive timeline override', () => {
  const leapActionList = buildActionList('leap', 'push-kick');
  const dashActionList = buildActionList('dash', 'push-kick');
  assert.deepEqual(
    leapActionList.map((entry) => entry.action),
    ['Adr+1', '3j', 'W', 'W', 'E'],
  );
  assert.deepEqual(
    dashActionList.map((entry) => entry.action),
    ['2m', 'W', 'W', 'E'],
  );
});

test('smoke-bomb passive inverts movement direction', () => {
  const forward = buildActionList('dash', 'smoke-bomb');
  assert.deepEqual(
    forward.map((entry) => entry.action),
    ['B2m', 'W', 'W', 'E'],
  );
  const backward = buildActionList('backflip', 'smoke-bomb');
  assert.deepEqual(
    backward.map((entry) => entry.action),
    ['m', 'W', 'E'],
  );
});

test('jab has no passive timeline override', () => {
  const stepCard = catalog.cardsById.get('step');
  assert.ok(stepCard);
  const actionList = buildActionList('step', 'jab');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    stepCard.actions,
  );
});

test('whirlwind passive replaces the final m with c-La-Ra-BLa-BRa-Ba', () => {
  const actionList = buildActionList('advance', 'whirlwind');
  assert.deepEqual(
    actionList.map((entry) => entry.action),
    ['W', 'm', 'c-La-Ra-BLa-BRa-Ba', 'E'],
  );
  assert.equal(actionList[2].damage, 1);
  assert.equal(actionList[2].kbf, 0);
});
