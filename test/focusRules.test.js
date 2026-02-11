const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  applyCardUse,
  clearFocusedAbilityCard,
  createDeckState,
  discardAbilityCards,
  getMaxAbilityHandSize,
  getMovementHandIds,
  resolveLandRefreshes,
  setFocusedAbilityCard,
} = require('../dist/game/cardRules.js');

const buildDeckDefinition = () => ({
  movement: ['move-a', 'move-b', 'move-c', 'move-d'],
  ability: ['rewind', 'ability-a', 'ability-b', 'ability-c', 'ability-d'],
});

const buildCharacter = () => ({
  userId: 'alpha',
  username: 'alpha',
  position: { q: 0, r: 0 },
  facing: 180,
  characterId: 'murelious',
  characterName: 'Alpha',
});

const buildEBeat = () => [[{
  username: 'alpha',
  action: 'E',
  rotation: '',
  priority: 0,
  damage: 0,
  location: { q: 0, r: 0 },
  facing: 180,
  calculated: false,
}]];

test('applyCardUse sets Rewind aside instead of cycling it under the deck', () => {
  const deckState = createDeckState(buildDeckDefinition());
  const originalDeck = [...deckState.abilityDeck];
  const useResult = applyCardUse(deckState, {
    movementCardId: 'move-a',
    abilityCardId: 'rewind',
    activeCardId: 'rewind',
    passiveCardId: 'move-a',
  });

  assert.equal(useResult.ok, true);
  assert.equal(deckState.abilityHand.includes('rewind'), false);
  assert.equal(deckState.abilityDeck.includes('rewind'), false);
  assert.equal(deckState.abilityDeck.length, originalDeck.length);
});

test('focused cards reduce max hand size and movement hand size by one per focus', () => {
  const deckState = createDeckState(buildDeckDefinition());

  assert.equal(getMaxAbilityHandSize(deckState), 4);
  assert.equal(getMovementHandIds(deckState).length, 4);

  const focusResult = setFocusedAbilityCard(deckState, 'rewind');
  assert.equal(focusResult.ok, true);
  assert.equal(deckState.focusedAbilityCardIds.has('rewind'), true);
  assert.equal(getMaxAbilityHandSize(deckState), 3);
  assert.equal(getMovementHandIds(deckState).length, 3);

  const clearResult = clearFocusedAbilityCard(deckState, 'rewind');
  assert.equal(clearResult.ok, true);
  assert.equal(deckState.focusedAbilityCardIds.has('rewind'), false);
  assert.equal(getMaxAbilityHandSize(deckState), 4);
  assert.equal(deckState.abilityDeck.at(-1), 'rewind');
});

test('resolveLandRefreshes skips draw refresh when Rewind focus is active', () => {
  const deckState = createDeckState(buildDeckDefinition());
  const focusResult = setFocusedAbilityCard(deckState, 'rewind');
  assert.equal(focusResult.ok, true);
  const discardResult = discardAbilityCards(deckState, { abilityCardIds: ['ability-a'], movementCardIds: [] });
  assert.equal(discardResult.ok, true);

  const beforeHandSize = deckState.abilityHand.length;
  resolveLandRefreshes(
    new Map([['alpha', deckState]]),
    buildEBeat(),
    [buildCharacter()],
    [{ q: 0, r: 0 }],
    [],
    undefined,
    [],
  );

  assert.equal(deckState.abilityHand.length, beforeHandSize);
  assert.equal(deckState.lastRefreshIndex, null);
});

test('resolveLandRefreshes skips draw refresh when active rewind focus interaction exists', () => {
  const deckState = createDeckState(buildDeckDefinition());
  const discardResult = discardAbilityCards(deckState, { abilityCardIds: ['ability-a'], movementCardIds: [] });
  assert.equal(discardResult.ok, true);
  assert.equal(deckState.focusedAbilityCardIds.has('rewind'), false);

  const beforeHandSize = deckState.abilityHand.length;
  resolveLandRefreshes(
    new Map([['alpha', deckState]]),
    buildEBeat(),
    [buildCharacter()],
    [{ q: 0, r: 0 }],
    [
      {
        id: 'rewind-focus:0:alpha:alpha',
        type: 'rewind-focus',
        beatIndex: 0,
        actorUserId: 'alpha',
        targetUserId: 'alpha',
        status: 'resolved',
        cardId: 'rewind',
        resolution: { active: true, cardId: 'rewind', anchorHex: { q: 0, r: 0 } },
      },
    ],
    undefined,
    [],
  );

  assert.equal(deckState.abilityHand.length, beforeHandSize);
  assert.equal(deckState.lastRefreshIndex, null);
});
