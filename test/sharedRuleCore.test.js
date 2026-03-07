const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCardActionList } = require('../dist/shared/game/cardText/actionListBuilder.js');
const { getThrowSpec } = require('../dist/shared/game/throwSpecs.js');
const { getHandTriggerDefinition, HAND_TRIGGER_CARD_IDS } = require('../dist/shared/game/handTriggers.js');
const { getPassiveKbfReduction, isThrowImmune } = require('../dist/shared/game/cardText/combatModifiers.js');
const {
  getActiveHitDiscardRule,
  isDiscardImmune,
  shouldConvertKbfToDiscard,
} = require('../dist/shared/game/cardText/discardEffects.js');

const movementCard = (id, actions = ['W', 'm', 'E']) => ({
  id,
  name: id,
  type: 'movement',
  actions,
  rotations: '*',
  damage: 0,
  kbf: 0,
  activeText: '',
  passiveText: '',
  timings: actions.map(() => null),
});

const abilityCard = (id, actions = ['W', '[a]', 'E']) => ({
  id,
  name: id,
  type: 'ability',
  actions,
  rotations: '*',
  damage: 2,
  kbf: 1,
  activeText: '',
  passiveText: '',
  timings: actions.map(() => null),
});

test('shared throw specs tag unconditional throws but leave grappling hook conditional', () => {
  const hipThrow = abilityCard('hip-throw');
  const step = movementCard('step');
  const hipThrowList = buildCardActionList(hipThrow, step, '0');
  assert.equal(hipThrowList[1].interaction?.type, 'throw');

  const grapplingHook = movementCard('grappling-hook', ['W', 'W', '[3c]', 'W', 'E']);
  grapplingHook.activeText = '{i}: Stop at first land or target. If starting on land, and the target is touching you: Throw.';
  grapplingHook.kbf = 1;
  const jab = abilityCard('jab');
  const hookList = buildCardActionList(grapplingHook, jab, '0');
  assert.equal(hookList[2].interaction, undefined);

  assert.deepEqual(getThrowSpec('grappling-hook', 'active'), {
    cardId: 'grappling-hook',
    role: 'active',
    mode: 'conditional',
    actionListInteraction: 'never',
    conditionId: 'grappling-hook-land-start-adjacent-target',
  });
});

test('shared hand trigger specs remain a single registry for all hand-trigger cards', () => {
  assert.deepEqual(new Set(HAND_TRIGGER_CARD_IDS), new Set(['burning-strike', 'sinking-shot', 'vengeance', 'iron-will']));
  assert.deepEqual(getHandTriggerDefinition('burning-strike'), {
    cardId: 'burning-strike',
    cardType: 'ability',
    trigger: 'attack-hit',
    effect: 'burning-strike',
    discardCount: 1,
  });
  assert.equal(getHandTriggerDefinition('jab'), null);
});

test('shared passive modifier registry keeps iron will active on DamageIcon but throw immunity off', () => {
  assert.equal(getPassiveKbfReduction({ passiveCardId: 'iron-will', action: 'DamageIcon' }), 1);
  assert.equal(isThrowImmune({ passiveCardId: 'hip-throw', action: 'DamageIcon' }), false);
  assert.equal(isThrowImmune({ passiveCardId: 'hip-throw', action: '[a]' }), true);
  assert.equal(isThrowImmune({ passiveCardId: 'hip-throw', action: 'SigE' }), false);
});

test('shared discard specs keep discard immunity and kbf conversion active on DamageIcon frames', () => {
  assert.deepEqual(getActiveHitDiscardRule('trip'), { count: 1, centerOnly: true });
  assert.equal(isDiscardImmune({ passiveCardId: 'spike', action: 'DamageIcon' }), true);
  assert.equal(shouldConvertKbfToDiscard({ passiveCardId: 'sweeping-strike', action: 'DamageIcon' }), true);
  assert.equal(isDiscardImmune({ passiveCardId: 'spike', action: 'SigE' }), false);
});
