const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { createDeckState, validateActionSubmission } = require('../dist/game/cardRules.js');
const { loadCardCatalog } = require('../dist/game/cardCatalog.js');

let regularCatalog;
let alternateCatalog;

before(async () => {
  regularCatalog = await loadCardCatalog('regular');
  alternateCatalog = await loadCardCatalog('alternate');
});

const buildActionList = (activeCardId, passiveCardId, rotation, catalog, ruleset) => {
  const deckState = createDeckState({ movement: [activeCardId], ability: [passiveCardId] });
  const result = validateActionSubmission({ activeCardId, passiveCardId, rotation }, deckState, catalog, { ruleset });
  assert.equal(result.ok, true, result.ok ? '' : result.error?.message);
  return result.actionList;
};

test('ninja-roll active applies opposite rotation at the bracketed movement beat (regular)', () => {
  const actionList = buildActionList('ninja-roll', 'burning-strike', 'R2', regularCatalog, 'regular');
  assert.equal(actionList[1].action, '[m]');
  assert.equal(actionList[1].rotation, 'L1');
  assert.equal(actionList[1].rotationSource, 'forced');
});

test('ninja-roll active applies opposite rotation at the beat text movement beat (alternate)', () => {
  const actionList = buildActionList('ninja-roll', 'burning-strike', 'R2', alternateCatalog, 'alternate');
  assert.equal(actionList[1].action, 'm');
  assert.equal(actionList[1].rotation, 'L1');
  assert.equal(actionList[1].rotationSource, 'forced');
});
