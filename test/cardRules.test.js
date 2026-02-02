const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDefaultDeckDefinition } = require('../dist/game/cardRules.js');

test('buildDefaultDeckDefinition uses the first catalog deck when available', () => {
  const catalog = {
    decks: [{ movement: ['step', 'dash'], ability: ['jab', 'guard'] }],
    movement: [],
    ability: [],
  };

  const deck = buildDefaultDeckDefinition(catalog);

  assert.deepEqual(deck, { movement: ['step', 'dash'], ability: ['jab', 'guard'] });
});

test('buildDefaultDeckDefinition falls back to catalog cards when decks are missing', () => {
  const catalog = {
    decks: [],
    movement: [
      { id: 'move-1' },
      { id: 'move-2' },
      { id: 'move-3' },
      { id: 'move-4' },
      { id: 'move-5' },
    ],
    ability: [
      { id: 'ability-1' },
      { id: 'ability-2' },
      { id: 'ability-3' },
      { id: 'ability-4' },
      { id: 'ability-5' },
      { id: 'ability-6' },
      { id: 'ability-7' },
      { id: 'ability-8' },
      { id: 'ability-9' },
      { id: 'ability-10' },
      { id: 'ability-11' },
      { id: 'ability-12' },
      { id: 'ability-13' },
    ],
  };

  const deck = buildDefaultDeckDefinition(catalog);

  assert.deepEqual(deck.movement, ['move-1', 'move-2', 'move-3', 'move-4']);
  assert.deepEqual(deck.ability, [
    'ability-1',
    'ability-2',
    'ability-3',
    'ability-4',
    'ability-5',
    'ability-6',
    'ability-7',
    'ability-8',
    'ability-9',
    'ability-10',
    'ability-11',
    'ability-12',
  ]);
});
