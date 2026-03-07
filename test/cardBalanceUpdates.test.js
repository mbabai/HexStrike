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

  assert.deepEqual(getCardById(catalog, 'fleche').actions, ['Adr+1', 'm', 'm', 'm', 'E']);
  assert.deepEqual(getCardById(catalog, 'leap').actions, ['Adr+1', '3j', 'W', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'balestra-lunge').actions, ['m', 'a', 'Adr+1', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'iron-will').actions, ['W', 'W', 'X1', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'healing-harmony').actions, ['X1', 'X1', 'X1', 'E']);
  assert.deepEqual(getCardById(catalog, 'tackle').actions, ['m', '[a]', 'W', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'chase').actions, ['m', '[c]', '[a]', 'Co', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'counter-attack').actions, ['[Bm]', 'a', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'flying-knee').actions, ['Adr+1', '[c]', 'Co', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'jab').actions, ['[a]', 'Co', 'Adr+1', 'E']);
  assert.deepEqual(getCardById(catalog, 'vengeance').actions, ['W', '[c]', '[c]', '[c]', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'haven').actions, ['W', 'X1', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'long-thrust').actions, ['W', 'a-2a', 'W', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'gigantic-staff').actions, ['W', 'W', 'a-2a-3a', 'W', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'push-kick').actions, ['[a-Bm]', 'W', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'bow-shot').actions, ['W', 'W', 'X1', 'SigE']);
  assert.deepEqual(getCardById(catalog, 'burning-strike').actions, ['W', '[a]', 'Co', 'W', 'SigE']);
  assert.deepEqual(getCardById(catalog, 'druidic-presence').actions, ['W', 'X1', 'X1', 'W', 'SigE']);
  assert.deepEqual(getCardById(catalog, 'parry').actions, ['[b]', '[b]', 'W', 'W', 'SigE']);
  assert.deepEqual(getCardById(catalog, 'aerial-strike').actions, ['W', '[2j]', 'a', 'W', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'hammer').actions, ['W', 'W', '[a-La-Ra]', 'W', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'smash-attack').actions, ['W', 'W', '[a]', 'W', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'whirlwind').actions, ['W', 'c-La-Ra-BLa-BRa-Ba', 'c-La-Ra-BLa-BRa-Ba', '[c-La-Ra-BLa-BRa-Ba]', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'hip-throw').actions, ['W', '[a]', 'W', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'spike').actions, ['W', 'W', '[a]', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'spinning-back-kick').actions, ['[Ba-BLa-BRa]', 'Co', 'W', 'E']);

  assert.equal(getCardById(catalog, 'hip-throw').damage, 3);
  assert.equal(getCardById(catalog, 'tackle').damage, 2);
  assert.equal(getCardById(catalog, 'double-daggers').damage, 3);
  assert.equal(getCardById(catalog, 'balestra-lunge').damage, 5);
  assert.equal(getCardById(catalog, 'vengeance').damage, 3);
  assert.equal(getCardById(catalog, 'push-kick').passiveText ?? '', '');
  assert.equal(getCardById(catalog, 'sinking-shot').passiveText ?? '', 'Pre-action: Take 2 damage, {Adr+1}.');

  assert.equal(getCardById(catalog, 'trip').name, 'Trip');
  assert.equal(getCardById(catalog, 'sweeping-strike').name, 'Sweeping Strike');
  assert.deepEqual(getCardById(catalog, 'trip').actions, ['[a-La-Ra]', 'W', 'W', 'E']);
  assert.deepEqual(getCardById(catalog, 'sweeping-strike').actions, ['W', '[a-La-Ra]', 'W', 'Adr+1', 'E']);

  assert.equal(existsSync('public/images/a-Bm.png'), true);
});

const normalizeActionLabel = (action) => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

test('card timing data is present for non-E/W beats', async () => {
  const catalog = await loadCardCatalog();
  const cards = [...catalog.movement, ...catalog.ability];
  cards.forEach((card) => {
    const timings = Array.isArray(card.timings) ? card.timings : [];
    card.actions.forEach((action, index) => {
      const label = normalizeActionLabel(action).toUpperCase();
      const timing = timings[index];
      if (label === 'E' || label === 'SIGE' || label === 'W' || label === 'CO' || /^ADR[+-]\d+$/.test(label)) {
        assert.equal(
          timing == null || (Array.isArray(timing) && timing.length === 0),
          true,
          `Expected ${card.id} action ${index} (${action}) to be untimed`,
        );
        return;
      }
      assert.equal(
        Array.isArray(timing) && timing.length > 0,
        true,
        `Expected ${card.id} action ${index} (${action}) to include timing`,
      );
    });
  });

  assert.deepEqual(getCardById(catalog, 'step').timings, [null, ['mid'], null]);
  assert.deepEqual(getCardById(catalog, 'advance').timings, [null, ['mid'], ['early'], null]);
  assert.deepEqual(getCardById(catalog, 'long-thrust').timings, [null, ['early'], null, null, null]);
  assert.deepEqual(getCardById(catalog, 'guard').timings, [null, ['early', 'mid', 'late'], ['early', 'mid', 'late'], null]);
  assert.deepEqual(getCardById(catalog, 'absorb').timings, [null, ['mid', 'late'], ['early', 'mid'], null, null]);
  assert.deepEqual(getCardById(catalog, 'parry').timings, [['late'], ['early', 'mid'], null, null, null]);
  assert.deepEqual(getCardById(catalog, 'aerial-strike').timings, [null, ['mid'], ['early'], null, null, null]);
  assert.equal(getCardById(catalog, 'backflip').passiveText ?? '', '');
});
