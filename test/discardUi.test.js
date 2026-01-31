const { test } = require('node:test');
const assert = require('node:assert/strict');

const loadModule = async () => import('../public/game/discardUi.mjs');

test('getDiscardStatus reports remaining discard counts', async () => {
  const { getDiscardStatus } = await loadModule();
  const status = getDiscardStatus({
    requiredMovement: 2,
    requiredAbility: 1,
    selectedMovement: 1,
    selectedAbility: 0,
  });

  assert.equal(status.movementRemaining, 1);
  assert.equal(status.abilityRemaining, 1);
  assert.equal(status.needsMovement, true);
  assert.equal(status.needsAbility, true);
  assert.equal(status.complete, false);
});

test('formatDiscardPrompt uses remaining counts', async () => {
  const { getDiscardStatus, formatDiscardPrompt } = await loadModule();
  const status = getDiscardStatus({
    requiredMovement: 1,
    requiredAbility: 2,
    selectedMovement: 1,
    selectedAbility: 2,
  });

  assert.equal(status.complete, true);
  assert.equal(formatDiscardPrompt(status), 'Discard: 0 movement, 0 ability');
});

test('getDiscardCounts caps discard requirements to hand size', async () => {
  const { getDiscardCounts } = await loadModule();
  const pending = { discardAbilityCount: 3, discardMovementCount: 5 };
  const playerCards = { abilityHand: ['a1', 'a2'], movementHand: ['m1'] };

  const counts = getDiscardCounts(pending, playerCards, 4);

  assert.equal(counts.ability, 2);
  assert.equal(counts.movement, 1);
});
