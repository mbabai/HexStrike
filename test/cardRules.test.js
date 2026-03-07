const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDefaultDeckDefinition, parseDeckDefinition } = require('../dist/game/cardRules.js');

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
const createParseCatalog = () => ({
  movement: [],
  ability: [],
  decks: [],
  cardsById: new Map([
    ['step', { id: 'step', type: 'movement' }],
    ['dash', { id: 'dash', type: 'movement' }],
    ['jump', { id: 'jump', type: 'movement' }],
    ['advance', { id: 'advance', type: 'movement' }],
    ['fleche', { id: 'fleche', type: 'movement', signatureGroup: 'movement' }],
    ['grappling-hook', { id: 'grappling-hook', type: 'movement', signatureGroup: 'movement' }],
    ['leap', { id: 'leap', type: 'movement', signatureGroup: 'movement' }],
    ['jab', { id: 'jab', type: 'ability' }],
    ['guard', { id: 'guard', type: 'ability' }],
    ['parry', { id: 'parry', type: 'ability', signatureGroup: 'ability' }],
    ['trip', { id: 'trip', type: 'ability' }],
    ['bow-shot', { id: 'bow-shot', type: 'ability', signatureGroup: 'ability' }],
    ['vengeance', { id: 'vengeance', type: 'ability', signatureGroup: 'ability' }],
  ]),
});

test('parseDeckDefinition requires Step in movement cards', () => {
  const catalog = createParseCatalog();
  const parsed = parseDeckDefinition(
    {
      movement: ['dash', 'jump', 'advance', 'fleche'],
      ability: ['jab', 'guard', 'parry', 'trip'],
    },
    catalog,
  );

  assert.ok(parsed.deck);
  assert.equal(
    parsed.errors.some((error) => error.code === 'missing-required-movement'),
    true,
  );
});

test('parseDeckDefinition limits decks to one signature movement card', () => {
  const catalog = createParseCatalog();
  const parsed = parseDeckDefinition(
    {
      movement: ['step', 'fleche', 'grappling-hook', 'dash'],
      ability: ['jab', 'guard', 'parry', 'trip'],
    },
    catalog,
  );

  assert.ok(parsed.deck);
  assert.equal(
    parsed.errors.some((error) => error.code === 'too-many-signature-moves'),
    true,
  );
});

test('parseDeckDefinition allows decks with Step and one signature movement card', () => {
  const catalog = createParseCatalog();
  const parsed = parseDeckDefinition(
    {
      movement: ['step', 'fleche', 'dash', 'jump'],
      ability: ['jab', 'guard', 'parry', 'trip'],
    },
    catalog,
  );

  assert.ok(parsed.deck);
  assert.equal(parsed.errors.length, 0);
});

test('parseDeckDefinition limits decks to two signature abilities', () => {
  const catalog = createParseCatalog();
  const parsed = parseDeckDefinition(
    {
      movement: ['step', 'dash', 'jump', 'advance'],
      ability: ['parry', 'bow-shot', 'vengeance', 'trip'],
    },
    catalog,
  );

  assert.ok(parsed.deck);
  assert.equal(
    parsed.errors.some((error) => error.code === 'too-many-signature-abilities'),
    true,
  );
});

test('parseDeckDefinition allows decks with up to two signature abilities', () => {
  const catalog = createParseCatalog();
  const parsed = parseDeckDefinition(
    {
      movement: ['step', 'dash', 'jump', 'advance'],
      ability: ['parry', 'bow-shot', 'guard', 'trip'],
    },
    catalog,
  );

  assert.ok(parsed.deck);
  assert.equal(parsed.errors.length, 0);
});

