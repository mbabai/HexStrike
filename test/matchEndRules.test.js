const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyDeathToBeats, applyMatchOutcomeToBeats, evaluateMatchOutcome } = require('../dist/game/matchEndRules.js');
const { buildDefaultLandHexes } = require('../dist/game/hexGrid.js');

const buildDeckState = ({
  movement = ['m1'],
  abilityHand = ['a1'],
  exhaustedMovementIds = [],
} = {}) => ({
  movement,
  abilityHand,
  abilityDeck: [],
  exhaustedMovementIds: new Set(exhaustedMovementIds),
  lastRefreshIndex: null,
  activeCardId: null,
  passiveCardId: null,
});

const buildEntry = (username, action, position) => ({
  username,
  action,
  rotation: '',
  priority: 0,
  damage: 0,
  location: { q: position.q, r: position.r },
  facing: 0,
  calculated: true,
});

test('distance loss triggers when a character is more than 4 hexes from land', () => {
  const land = buildDefaultLandHexes();
  const characters = [
    { userId: 'far', username: 'far', position: { q: 9, r: 0 }, facing: 0, characterId: 'murelious' },
    { userId: 'near', username: 'near', position: { q: 0, r: 0 }, facing: 0, characterId: 'murelious' },
  ];
  const beats = [
    [
      buildEntry('far', 'E', characters[0].position),
      buildEntry('near', 'E', characters[1].position),
    ],
  ];
  const deckStates = new Map();
  deckStates.set('far', buildDeckState());
  deckStates.set('near', buildDeckState());

  const outcome = evaluateMatchOutcome(beats, characters, deckStates, land);

  assert.ok(outcome, 'match outcome should exist');
  assert.equal(outcome.loserUserId, 'far');
  assert.equal(outcome.reason, 'far-from-land');
  assert.equal(outcome.beatIndex, 1);
});

test('no-cards abyss loss only triggers when the player is at the earliest E', () => {
  const land = buildDefaultLandHexes();
  const characters = [
    { userId: 'stalled', username: 'stalled', position: { q: 3, r: 0 }, facing: 0, characterId: 'murelious' },
    { userId: 'other', username: 'other', position: { q: 0, r: 0 }, facing: 0, characterId: 'murelious' },
  ];
  const beats = [
    [
      buildEntry('stalled', 'E', characters[0].position),
      buildEntry('other', 'E', characters[1].position),
    ],
    [
      buildEntry('stalled', 'm', characters[0].position),
      buildEntry('other', 'E', characters[1].position),
    ],
    [
      buildEntry('stalled', 'E', characters[0].position),
      buildEntry('other', 'E', characters[1].position),
    ],
  ];
  beats[1].forEach((entry) => {
    entry.calculated = false;
  });
  beats[2].forEach((entry) => {
    entry.calculated = false;
  });
  const deckStates = new Map();
  deckStates.set(
    'stalled',
    buildDeckState({
      movement: ['m1'],
      abilityHand: [],
      exhaustedMovementIds: ['m1'],
    }),
  );
  deckStates.set('other', buildDeckState());

  const outcome = evaluateMatchOutcome(beats, characters, deckStates, land);

  assert.equal(outcome, null);
});

test('no-cards abyss loss triggers at the earliest E on abyss', () => {
  const land = buildDefaultLandHexes();
  const characters = [
    { userId: 'stalled', username: 'stalled', position: { q: 3, r: 0 }, facing: 0, characterId: 'murelious' },
    { userId: 'other', username: 'other', position: { q: 0, r: 0 }, facing: 0, characterId: 'murelious' },
  ];
  const beats = [
    [
      buildEntry('stalled', 'E', characters[0].position),
      buildEntry('other', 'E', characters[1].position),
    ],
  ];
  const deckStates = new Map();
  deckStates.set(
    'stalled',
    buildDeckState({
      movement: ['m1'],
      abilityHand: [],
      exhaustedMovementIds: ['m1'],
    }),
  );
  deckStates.set('other', buildDeckState());

  const outcome = evaluateMatchOutcome(beats, characters, deckStates, land);

  assert.ok(outcome, 'match outcome should exist');
  assert.equal(outcome.loserUserId, 'stalled');
  assert.equal(outcome.reason, 'no-cards-abyss');
});

test('applyDeathToBeats inserts death and clears later entries for the loser', () => {
  const characters = [
    { userId: 'loser', username: 'loser', position: { q: 0, r: 0 }, facing: 0, characterId: 'murelious' },
    { userId: 'winner', username: 'winner', position: { q: 1, r: 0 }, facing: 0, characterId: 'murelious' },
  ];
  const beats = [
    [
      buildEntry('loser', 'W', characters[0].position),
      buildEntry('winner', 'W', characters[1].position),
    ],
    [
      buildEntry('loser', 'm', characters[0].position),
      buildEntry('winner', 'W', characters[1].position),
    ],
    [
      buildEntry('loser', 'E', characters[0].position),
      buildEntry('winner', 'W', characters[1].position),
    ],
  ];

  applyDeathToBeats(beats, characters, 'loser', 1);

  const deathEntry = beats[1].find((entry) => entry.username === 'loser');
  assert.ok(deathEntry, 'death entry should exist');
  assert.equal(deathEntry.action, 'Death');
  assert.equal(beats[1].some((entry) => entry.username === 'winner'), true);
  assert.equal(beats[2].some((entry) => entry.username === 'loser'), false);
});

test('applyMatchOutcomeToBeats inserts death and victory on the same beat and trims later beats', () => {
  const characters = [
    { userId: 'loser', username: 'loser', position: { q: 0, r: 0 }, facing: 0, characterId: 'murelious' },
    { userId: 'winner', username: 'winner', position: { q: 1, r: 0 }, facing: 0, characterId: 'murelious' },
  ];
  const beats = [
    [
      buildEntry('loser', 'W', characters[0].position),
      buildEntry('winner', 'W', characters[1].position),
    ],
    [
      buildEntry('loser', 'E', characters[0].position),
      buildEntry('winner', 'E', characters[1].position),
    ],
    [
      buildEntry('loser', 'm', characters[0].position),
      buildEntry('winner', 'm', characters[1].position),
    ],
  ];

  applyMatchOutcomeToBeats(beats, characters, {
    winnerUserId: 'winner',
    loserUserId: 'loser',
    reason: 'forfeit',
    beatIndex: 1,
  });

  assert.equal(beats.length, 2);
  assert.equal(beats[1].find((entry) => entry.username === 'loser')?.action, 'Death');
  assert.equal(beats[1].find((entry) => entry.username === 'winner')?.action, 'Victory');
});

test('applyMatchOutcomeToBeats inserts handshake for both players on draw', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 0, characterId: 'murelious' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 0, characterId: 'murelious' },
  ];
  const beats = [
    [
      buildEntry('alpha', 'W', characters[0].position),
      buildEntry('beta', 'W', characters[1].position),
    ],
    [
      buildEntry('alpha', 'E', characters[0].position),
      buildEntry('beta', 'E', characters[1].position),
    ],
  ];

  applyMatchOutcomeToBeats(beats, characters, {
    reason: 'draw-agreement',
    beatIndex: 1,
    drawUserIds: ['alpha', 'beta'],
  });

  assert.equal(beats.length, 2);
  assert.equal(beats[1].find((entry) => entry.username === 'alpha')?.action, 'Handshake');
  assert.equal(beats[1].find((entry) => entry.username === 'beta')?.action, 'Handshake');
});
