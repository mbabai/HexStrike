const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldBotAcceptDrawOffer } = require('../dist/game/drawOfferRules.js');

test('easy bot always accepts draw offers', () => {
  assert.equal(shouldBotAcceptDrawOffer('easy', 0, 999), true);
  assert.equal(shouldBotAcceptDrawOffer('easy', 120, 0), true);
});

test("medium bot accepts when bot damage is at least player's damage minus 10", () => {
  assert.equal(shouldBotAcceptDrawOffer('medium', 20, 30), true);
  assert.equal(shouldBotAcceptDrawOffer('medium', 19, 30), false);
  assert.equal(shouldBotAcceptDrawOffer('medium', 5, 10), true);
});

test("hard bot accepts only when bot damage is at least player's damage plus 10", () => {
  assert.equal(shouldBotAcceptDrawOffer('hard', 40, 30), true);
  assert.equal(shouldBotAcceptDrawOffer('hard', 39, 30), false);
  assert.equal(shouldBotAcceptDrawOffer('hard', 10, 0), true);
});
