const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { loadCardCatalog } = require('../dist/game/cardCatalog.js');

const getCardById = (catalog, id) => {
  const card = catalog.cardsById.get(id);
  assert.ok(card, `Expected card ${id} to exist`);
  return card;
};

test('card balance update applies timeline, damage, and naming changes', async () => {
  const catalog = await loadCardCatalog();

  assert.deepEqual(getCardById(catalog, 'iron-will').actions, ['W', 'W', 'X1', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'healing-harmony').actions, ['W', 'W', 'X1', 'E']);
  assert.deepEqual(getCardById(catalog, 'tackle').actions, ['m', '[a]', 'W', 'W', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'chase').actions, ['m', 'c', 'a', 'Co', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'vengeance').actions, ['W', 'c', 'c', 'c', 'W', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'haven').actions, ['W', 'X1', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'long-thrust').actions, ['W', 'a-2a', 'W', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'gigantic-staff').actions, ['W', 'W', 'a-2a-3a', 'W', 'W', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'push-kick').actions, ['a-Bm', 'W', 'W', 'E']);

  assert.equal(getCardById(catalog, 'hip-throw').damage, 3);
  assert.equal(getCardById(catalog, 'tackle').damage, 2);
  assert.equal(getCardById(catalog, 'double-daggers').damage, 3);

  assert.equal(getCardById(catalog, 'sweeping-strike').name, 'Trip');
  assert.equal(getCardById(catalog, 'trip').name, 'Sweeping Strike');
  assert.deepEqual(getCardById(catalog, 'sweeping-strike').actions, ['[a-La-Ra]', 'W', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'trip').actions, ['W', '[a-La-Ra]', 'W', 'W', 'E']);

  assert.equal(existsSync('public/images/a-Bm.png'), true);
});

test('card balance update keeps priorities unique with tie-break ordering', async () => {
  const catalog = await loadCardCatalog();
  const cards = [...catalog.movement, ...catalog.ability];
  const uniquePriorities = new Set(cards.map((card) => card.priority));

  assert.equal(uniquePriorities.size, cards.length, 'Expected all priorities to be unique');

  assert.equal(getCardById(catalog, 'balestra-lunge').priority, 49);
  assert.equal(getCardById(catalog, 'chase').priority, 58);
  assert.equal(getCardById(catalog, 'fumikomi').priority, 48);

  assert.equal(getCardById(catalog, 'advance').priority, 15);
  assert.equal(getCardById(catalog, 'healing-harmony').priority, 16);
  assert.equal(getCardById(catalog, 'fleche').priority, 62);
  assert.equal(getCardById(catalog, 'stab').priority, 63);
  assert.equal(getCardById(catalog, 'trip').priority, 65);
  assert.equal(getCardById(catalog, 'jab').priority, 66);
  assert.equal(getCardById(catalog, 'leap').priority, 67);
  assert.equal(getCardById(catalog, 'whirlwind').priority, 68);
  assert.equal(getCardById(catalog, 'spike').priority, 69);
  assert.equal(getCardById(catalog, 'aerial-strike').priority, 88);
  assert.equal(getCardById(catalog, 'burning-strike').priority, 89);
});
