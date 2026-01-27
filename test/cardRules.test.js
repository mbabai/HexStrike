const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCardCatalog } = require('../dist/game/cardCatalog.js');
const { applyCardUse, createDeckState, resolveLandRefreshes, validateActionSubmission } = require('../dist/game/cardRules.js');

const buildSampleDeck = (catalog) => ({
  movement: catalog.movement.slice(0, 4).map((card) => card.id),
  ability: catalog.ability.slice(0, 12).map((card) => card.id),
});

test('validateActionSubmission enforces hand and movement exhaustion', async () => {
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

test('validateActionSubmission ignores grappling hook throw keyword', async () => {
  const catalog = await loadCardCatalog();
  const grapplingHook = catalog.cardsById.get('grappling-hook');
  assert.ok(grapplingHook);
  const nonThrowAbility = catalog.ability.find((card) => {
    const text = `${card?.activeText ?? ''} ${card?.passiveText ?? ''}`;
    return !/\bthrow\b/i.test(text);
  });
  assert.ok(nonThrowAbility);
  const deckState = createDeckState({ movement: [grapplingHook.id], ability: [nonThrowAbility.id] });
  const result = validateActionSubmission(
    { activeCardId: grapplingHook.id, passiveCardId: nonThrowAbility.id, rotation: '0' },
    deckState,
    catalog,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    const hasThrowInteraction = result.actionList.some((item) => item.interaction?.type === 'throw');
    assert.equal(hasThrowInteraction, false);
  }
});

test('validateActionSubmission ignores passive card activeText for throw detection', () => {
  const movementCard = {
    id: 'move-attack',
    name: 'Move Attack',
    type: 'movement',
    priority: 10,
    actions: ['a', 'E'],
    rotations: '*',
    damage: 1,
    kbf: 0,
  };
  const passiveAbility = {
    id: 'passive-throw',
    name: 'Passive Throw',
    type: 'ability',
    priority: 10,
    actions: ['W', 'E'],
    rotations: '*',
    damage: 0,
    kbf: 0,
    activeText: 'Throw',
  };
  const catalog = {
    movement: [movementCard],
    ability: [passiveAbility],
    decks: [],
    cardsById: new Map([
      [movementCard.id, movementCard],
      [passiveAbility.id, passiveAbility],
    ]),
  };
  const deckState = createDeckState({ movement: [movementCard.id], ability: [passiveAbility.id] });
  const result = validateActionSubmission(
    { activeCardId: movementCard.id, passiveCardId: passiveAbility.id, rotation: '0' },
    deckState,
    catalog,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    const hasThrowInteraction = result.actionList.some((item) => item.interaction?.type === 'throw');
    assert.equal(hasThrowInteraction, false);
  }
});

test('validateActionSubmission marks throws from passive throw text', async () => {
  const catalog = await loadCardCatalog();
  const leap = catalog.cardsById.get('leap');
  const jab = catalog.cardsById.get('jab');
  assert.ok(leap);
  assert.ok(jab);
  const deckState = createDeckState({ movement: [leap.id], ability: [jab.id] });
  const result = validateActionSubmission(
    { activeCardId: jab.id, passiveCardId: leap.id, rotation: '0' },
    deckState,
    catalog,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    const hasThrowInteraction = result.actionList.some((item) => item.interaction?.type === 'throw');
    assert.equal(hasThrowInteraction, true);
  }
});

test('validateActionSubmission marks throws from active throw text', async () => {
  const catalog = await loadCardCatalog();
  const hipThrow = catalog.cardsById.get('hip-throw');
  const step = catalog.cardsById.get('step');
  assert.ok(hipThrow);
  assert.ok(step);
  const deckState = createDeckState({ movement: [step.id], ability: [hipThrow.id] });
  const result = validateActionSubmission(
    { activeCardId: hipThrow.id, passiveCardId: step.id, rotation: '0' },
    deckState,
    catalog,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    const hasThrowInteraction = result.actionList.some((item) => item.interaction?.type === 'throw');
    assert.equal(hasThrowInteraction, true);
  }
});

test('applyCardUse removes ability card and exhausts movement', async () => {
  const catalog = await loadCardCatalog();
  const deck = buildSampleDeck(catalog);
  const deckState = createDeckState(deck);
  const movementCardId = deck.movement[0];
  const abilityCardId = deck.ability[1];
  const result = applyCardUse(deckState, { movementCardId, abilityCardId });
  assert.equal(result.ok, true);
  assert.equal(deckState.exhaustedMovementIds.has(movementCardId), true);
  assert.equal(deckState.abilityHand.includes(abilityCardId), false);
  assert.equal(deckState.abilityDeck[deckState.abilityDeck.length - 1], abilityCardId);
  assert.equal(deckState.abilityHand.length, 3);
});

test('resolveLandRefreshes clears movement exhaustion and draws on land', async () => {
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
  applyCardUse(onLandState, { movementCardId, abilityCardId });
  resolveLandRefreshes(new Map([['player-1', onLandState]]), beats, [character], [{ q: 0, r: 0 }]);
  assert.equal(onLandState.exhaustedMovementIds.size, 0);
  assert.equal(onLandState.abilityHand.length, 4);
  assert.equal(onLandState.lastRefreshIndex, 0);
});

test('resolveLandRefreshes skips refresh off land', async () => {
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

  const offLandState = createDeckState(deck);
  applyCardUse(offLandState, { movementCardId, abilityCardId });
  resolveLandRefreshes(new Map([['player-1', offLandState]]), beats, [character], [{ q: 2, r: 2 }]);
  assert.equal(offLandState.exhaustedMovementIds.has(movementCardId), true);
  assert.equal(offLandState.abilityHand.length, 3);
  assert.equal(offLandState.lastRefreshIndex, null);
});

test('resolveLandRefreshes uses beat location over character position', async () => {
  const catalog = await loadCardCatalog();
  const deck = buildSampleDeck(catalog);
  const movementCardId = deck.movement[0];
  const abilityCardId = deck.ability[0];
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
        location: { q: 5, r: 0 },
        facing: 0,
        calculated: false,
      },
    ],
  ];
  const deckState = createDeckState(deck);
  applyCardUse(deckState, { movementCardId, abilityCardId });
  resolveLandRefreshes(new Map([['player-1', deckState]]), beats, [character], [{ q: 0, r: 0 }]);
  assert.equal(deckState.exhaustedMovementIds.has(movementCardId), true);
  assert.equal(deckState.abilityHand.length, 3);
  assert.equal(deckState.lastRefreshIndex, null);
});

test('resolveLandRefreshes skips refresh while pending actions at earliest beat', async () => {
  const catalog = await loadCardCatalog();
  const deck = buildSampleDeck(catalog);
  const movementCardId = deck.movement[0];
  const abilityCardId = deck.ability[0];
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
  const deckState = createDeckState(deck);
  applyCardUse(deckState, { movementCardId, abilityCardId });
  resolveLandRefreshes(
    new Map([['player-1', deckState]]),
    beats,
    [character],
    [{ q: 0, r: 0 }],
    [],
    { beatIndex: 0, requiredUserIds: ['player-1'], submittedUserIds: ['player-1'] },
  );
  assert.equal(deckState.exhaustedMovementIds.has(movementCardId), true);
  assert.equal(deckState.abilityHand.length, 3);
  assert.equal(deckState.lastRefreshIndex, null);
});
