const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyFfaLifecycle } = require('../dist/game/ffaLifecycle.js');
const { createInitialFfaState } = require('../dist/game/ffaState.js');

const makeDeckState = (overrides = {}) => ({
  movement: ['m1', 'm2', 'm3', 'm4'],
  abilityHand: ['a1', 'a2', 'a3', 'a4'],
  abilityDeck: ['a5', 'a6', 'a7', 'a8'],
  baseMaxHandSize: 4,
  focusedAbilityCardIds: new Set(),
  exhaustedMovementIds: new Set(),
  lastRefreshIndex: null,
  activeCardId: null,
  passiveCardId: null,
  ...overrides,
});

test('applyFfaLifecycle awards point, ends at 2 points, and prepares center/0/full-hand respawn', () => {
  const characters = [
    {
      userId: 'p1',
      username: 'p1',
      characterId: 'murelious',
      characterName: 'Murelious',
      position: { q: 1, r: 0 },
      facing: 0,
      damage: 0,
    },
    {
      userId: 'p2',
      username: 'p2',
      characterId: 'zenytha',
      characterName: 'Zenytha',
      position: { q: 2, r: 0 },
      facing: 180,
      damage: 0,
    },
    {
      userId: 'p3',
      username: 'p3',
      characterId: 'strylan',
      characterName: 'Strylan',
      position: { q: -1, r: 0 },
      facing: 240,
      damage: 0,
    },
  ];
  const beats = [
    [
      {
        username: 'p1',
        action: 'W',
        rotation: '',
        priority: 0,
        damage: 0,
        location: { q: 1, r: 0 },
        terrain: 'land',
        facing: 0,
        calculated: true,
      },
      {
        username: 'p2',
        action: 'DamageIcon',
        rotation: '',
        priority: 0,
        damage: 7,
        location: { q: 8, r: 0 },
        terrain: 'abyss',
        facing: 180,
        calculated: true,
        consequences: [{ type: 'hit', damageDelta: 2, knockbackDistance: 1, sourceUserId: 'p1' }],
      },
      {
        username: 'p3',
        action: 'W',
        rotation: '',
        priority: 0,
        damage: 0,
        location: { q: -1, r: 0 },
        terrain: 'land',
        facing: 240,
        calculated: true,
      },
    ],
  ];
  const land = [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: -1, r: 0 },
    { q: 0, r: 1 },
    { q: 0, r: -1 },
  ];
  const deckStates = new Map([
    ['p1', makeDeckState()],
    [
      'p2',
      makeDeckState({
        abilityHand: ['h1', 'h2', 'h3', 'h4'],
        abilityDeck: ['d1'],
        focusedAbilityCardIds: new Set(['focus-card']),
        exhaustedMovementIds: new Set(['m1', 'm2']),
        activeCardId: 'old-active',
        passiveCardId: 'old-passive',
      }),
    ],
    ['p3', makeDeckState()],
  ]);
  const ffa = createInitialFfaState(characters);
  ffa.playerStates.p1.score = 1;

  const result = applyFfaLifecycle({
    beats,
    characters,
    land,
    deckStates,
    ffa,
  });

  assert.equal(result.outcome?.winnerUserId, 'p1');
  assert.equal(result.ffa.playerStates.p1.score, 2);
  assert.deepEqual(result.ffa.playerStates.p2.deathWindows, [{ startBeatIndex: 1, endBeatIndex: 10 }]);
  assert.deepEqual(result.ffa.playerStates.p2.invulnerableWindows, [{ startBeatIndex: 11, endBeatIndex: 15 }]);

  const respawnEntry = beats[11].find((entry) => entry.username === 'p2');
  assert.ok(respawnEntry);
  assert.equal(respawnEntry.action, 'E');
  assert.equal(respawnEntry.respawn, true);
  assert.deepEqual(respawnEntry.location, { q: 0, r: 0 });
  assert.equal(respawnEntry.damage, 0);
  assert.equal(respawnEntry.abilityHandCount, 4);

  const p2Deck = deckStates.get('p2');
  assert.equal(p2Deck.abilityHand.length, 4);
  assert.deepEqual(p2Deck.abilityHand, ['d1', 'h1', 'h2', 'h3']);
  assert.deepEqual(p2Deck.abilityDeck, ['h4']);
  assert.equal(p2Deck.focusedAbilityCardIds.size, 0);
  assert.equal(p2Deck.exhaustedMovementIds.size, 0);
  assert.equal(p2Deck.activeCardId, null);
  assert.equal(p2Deck.passiveCardId, null);
});

test('applyFfaLifecycle ends match when a player already has 2 points', () => {
  const characters = [
    {
      userId: 'p1',
      username: 'p1',
      characterId: 'murelious',
      characterName: 'Murelious',
      position: { q: 1, r: 0 },
      facing: 0,
      damage: 0,
    },
    {
      userId: 'p2',
      username: 'p2',
      characterId: 'zenytha',
      characterName: 'Zenytha',
      position: { q: -1, r: 0 },
      facing: 180,
      damage: 0,
    },
    {
      userId: 'p3',
      username: 'p3',
      characterId: 'strylan',
      characterName: 'Strylan',
      position: { q: 0, r: 1 },
      facing: 240,
      damage: 0,
    },
  ];
  const beats = [
    [
      {
        username: 'p1',
        action: 'E',
        rotation: '',
        priority: 0,
        damage: 0,
        location: { q: 1, r: 0 },
        terrain: 'land',
        facing: 0,
        calculated: true,
      },
      {
        username: 'p2',
        action: 'E',
        rotation: '',
        priority: 0,
        damage: 0,
        location: { q: -1, r: 0 },
        terrain: 'land',
        facing: 180,
        calculated: true,
      },
      {
        username: 'p3',
        action: 'E',
        rotation: '',
        priority: 0,
        damage: 0,
        location: { q: 0, r: 1 },
        terrain: 'land',
        facing: 240,
        calculated: true,
      },
    ],
  ];
  const land = [{ q: 0, r: 0 }];
  const deckStates = new Map([
    ['p1', makeDeckState()],
    ['p2', makeDeckState()],
    ['p3', makeDeckState()],
  ]);
  const ffa = createInitialFfaState(characters);
  ffa.playerStates.p1.score = 2;

  const result = applyFfaLifecycle({
    beats,
    characters,
    land,
    deckStates,
    ffa,
  });

  assert.equal(result.outcome?.winnerUserId, 'p1');
});
