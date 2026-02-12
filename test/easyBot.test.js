const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCardCatalog } = require('../dist/game/cardCatalog.js');
const { createInitialGameState } = require('../dist/game/state.js');
const { createDeckState, buildDefaultDeckDefinition } = require('../dist/game/cardRules.js');
const {
  buildEasyBotActionCandidates,
  buildEasyBotInteractionCandidates,
} = require('../dist/bot/easyBot.js');
const { buildTopWeightedDistribution, buildWeightedChoiceOrder } = require('../dist/bot/weightedChoice.js');

test('easy bot weighted ordering favors higher scores', () => {
  const candidates = [
    { id: 'best', score: 100 },
    { id: 'mid', score: 10 },
    { id: 'low', score: 1 },
  ];

  const distribution = buildTopWeightedDistribution(candidates, 3);
  assert.equal(distribution.length, 3);
  assert.ok(distribution[0].probability > distribution[1].probability);
  assert.ok(distribution[1].probability > distribution[2].probability);

  const order = buildWeightedChoiceOrder(candidates, () => 0, 3);
  assert.equal(order[0].id, 'best');
});

test('easy bot falls back to uniform probabilities when top scores are non-positive', () => {
  const candidates = [
    { id: 'a', score: -3 },
    { id: 'b', score: -5 },
  ];

  const distribution = buildTopWeightedDistribution(candidates, 2);
  assert.equal(distribution.length, 2);
  assert.equal(distribution[0].probability, 0.5);
  assert.equal(distribution[1].probability, 0.5);
});

test('easy bot enumerates legal action-set candidates', async () => {
  const catalog = await loadCardCatalog();
  const deck = buildDefaultDeckDefinition(catalog);
  const publicState = (await createInitialGameState([
    { userId: 'bot', username: 'Hex-Bot', characterId: 'murelious' },
    { userId: 'enemy', username: 'enemy', characterId: 'strylan' },
  ])).public;
  const deckStates = new Map([
    ['bot', createDeckState(deck)],
    ['enemy', createDeckState(deck)],
  ]);

  const candidates = buildEasyBotActionCandidates({
    botUserId: 'bot',
    publicState,
    deckStates,
    catalog,
  });

  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((candidate) => candidate.kind === 'action-set'));
});

test('easy bot enumerates throw interaction choices', async () => {
  const catalog = await loadCardCatalog();
  const deck = buildDefaultDeckDefinition(catalog);
  const publicState = (await createInitialGameState([
    { userId: 'bot', username: 'Hex-Bot', characterId: 'murelious' },
    { userId: 'enemy', username: 'enemy', characterId: 'strylan' },
  ])).public;
  const throwInteraction = {
    id: 'throw:0:bot:enemy',
    type: 'throw',
    beatIndex: 0,
    actorUserId: 'bot',
    targetUserId: 'enemy',
    status: 'pending',
  };
  publicState.customInteractions = [throwInteraction];

  const deckStates = new Map([
    ['bot', createDeckState(deck)],
    ['enemy', createDeckState(deck)],
  ]);
  const candidates = buildEasyBotInteractionCandidates(
    {
      botUserId: 'bot',
      publicState,
      deckStates,
      catalog,
    },
    throwInteraction,
  );

  assert.equal(candidates.length, 6);
  const directions = candidates.map((candidate) => candidate.payload.directionIndex).sort((a, b) => a - b);
  assert.deepEqual(directions, [0, 1, 2, 3, 4, 5]);
});
