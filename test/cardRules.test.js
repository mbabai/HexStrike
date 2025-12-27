const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCardCatalog } = require('../dist/game/cardCatalog.js');
const { createDeckState, resolvePendingRefreshes, validateActionSubmission } = require('../dist/game/cardRules.js');

const buildSampleDeck = (catalog) => ({
  movement: catalog.movement.slice(0, 4).map((card) => card.id),
  ability: catalog.ability.slice(0, 12).map((card) => card.id),
});

test('validateActionSubmission enforces hand and exhaustion', async () => {
  const catalog = await loadCardCatalog();
  const deck = buildSampleDeck(catalog);
  const deckState = createDeckState(deck);
  const movementCardId = deck.movement[0];
  const abilityInHand = deck.ability[0];
  const abilityNotInHand = deck.ability[6];

  const notInHand = validateActionSubmission(
    { activeCardId: movementCardId, passiveCardId: abilityNotInHand, rotation: '0' },
    deckState,
    catalog,
  );
  assert.equal(notInHand.ok, false);
  if (!notInHand.ok) {
    assert.equal(notInHand.error.code, 'card-unavailable');
  }

  deckState.exhaustedMovementIds.add(movementCardId);
  const exhausted = validateActionSubmission(
    { activeCardId: movementCardId, passiveCardId: abilityInHand, rotation: '0' },
    deckState,
    catalog,
  );
  assert.equal(exhausted.ok, false);
  if (!exhausted.ok) {
    assert.equal(exhausted.error.code, 'card-exhausted');
  }
});

test('resolvePendingRefreshes clears movement exhaustion only on land', async () => {
  const catalog = await loadCardCatalog();
  const deck = buildSampleDeck(catalog);
  const movementCardId = deck.movement[0];
  const abilityCardId = deck.ability[1];
  const character = {
    userId: 'player-1',
    username: 'Player 1',
    characterId: 'murelious',
    characterName: 'Murelious',
    position: { q: 0, r: 0 },
    facing: 0,
  };
  const beats = [
    [
      {
        username: 'Player 1',
        action: 'E',
        rotation: '',
        priority: 0,
        damage: 0,
        location: { q: 0, r: 0 },
        facing: 0,
        calculated: false,
      },
    ],
  ];

  const onLandState = createDeckState(deck);
  onLandState.exhaustedMovementIds.add(movementCardId);
  onLandState.exhaustedAbilityIds.add(abilityCardId);
  onLandState.pendingRefresh = { beatIndex: 0, movementCardId, abilityCardId };
  resolvePendingRefreshes(new Map([['player-1', onLandState]]), beats, [character], [{ q: 0, r: 0 }]);
  assert.equal(onLandState.pendingRefresh, undefined);
  assert.equal(onLandState.exhaustedMovementIds.size, 0);
  assert.equal(onLandState.exhaustedAbilityIds.has(abilityCardId), false);
  assert.equal(onLandState.abilityHand.includes(abilityCardId), false);
  assert.equal(onLandState.abilityHand.length, 4);

  const offLandState = createDeckState(deck);
  offLandState.exhaustedMovementIds.add(movementCardId);
  offLandState.exhaustedAbilityIds.add(abilityCardId);
  offLandState.pendingRefresh = { beatIndex: 0, movementCardId, abilityCardId };
  resolvePendingRefreshes(new Map([['player-1', offLandState]]), beats, [character], [{ q: 2, r: 2 }]);
  assert.equal(offLandState.pendingRefresh, undefined);
  assert.equal(offLandState.exhaustedMovementIds.has(movementCardId), true);
  assert.equal(offLandState.exhaustedAbilityIds.has(abilityCardId), false);
});

test('resolvePendingRefreshes aligns pending refresh to current first E', async () => {
  const catalog = await loadCardCatalog();
  const deck = buildSampleDeck(catalog);
  const movementCardId = deck.movement[0];
  const abilityCardId = deck.ability[2];
  const character = {
    userId: 'player-1',
    username: 'Player 1',
    characterId: 'murelious',
    characterName: 'Murelious',
    position: { q: 0, r: 0 },
    facing: 0,
  };
  const beats = [
    [
      {
        username: 'Player 1',
        action: 'W',
        rotation: '',
        priority: 0,
        damage: 0,
        location: { q: 0, r: 0 },
        facing: 0,
        calculated: false,
      },
    ],
    [
      {
        username: 'Player 1',
        action: 'DamageIcon',
        rotation: '',
        priority: 0,
        damage: 1,
        location: { q: 0, r: 0 },
        facing: 0,
        calculated: false,
      },
    ],
    [
      {
        username: 'Player 1',
        action: 'E',
        rotation: '',
        priority: 0,
        damage: 1,
        location: { q: 0, r: 0 },
        facing: 0,
        calculated: false,
      },
    ],
  ];
  const deckState = createDeckState(deck);
  deckState.exhaustedMovementIds.add(movementCardId);
  deckState.exhaustedAbilityIds.add(abilityCardId);
  deckState.pendingRefresh = { beatIndex: 1, movementCardId, abilityCardId };

  resolvePendingRefreshes(new Map([['player-1', deckState]]), beats, [character], [{ q: 0, r: 0 }]);

  assert.equal(deckState.pendingRefresh, undefined);
  assert.equal(deckState.exhaustedMovementIds.size, 0);
  assert.equal(deckState.exhaustedAbilityIds.has(abilityCardId), false);
});
