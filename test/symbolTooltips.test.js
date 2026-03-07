const test = require('node:test');
const assert = require('node:assert/strict');

const cards = require('../public/cards/cards.json');
const {
  getRulebookSymbolTooltipText,
  resolveRulebookSymbolTooltip,
} = require('../dist/shared/game/symbolTooltips.js');

const INLINE_SYMBOL_PATTERN = /(\{[^}]+\}|\[[^\]]+\])/g;

const collectInlineTokens = (text) => {
  const source = `${text ?? ''}`;
  const matches = source.match(INLINE_SYMBOL_PATTERN) ?? [];
  return matches
    .map((token) => token.slice(1, -1).trim())
    .filter(Boolean);
};

const getAllCards = () => [...(cards.movement || []), ...(cards.ability || [])];

test('rulebook symbol tooltip registry keeps exact core copy', () => {
  assert.equal(getRulebookSymbolTooltipText('open-beat'), 'Refresh beat with no committed action.');
  assert.equal(
    getRulebookSymbolTooltipText('timing-marker'),
    'Timing markers. [earlyRules] resolves before [midRules], and [midRules] resolves before [lateRules].',
  );
  assert.equal(
    getRulebookSymbolTooltipText('throw-kbf'),
    'Throw knockback marker (KBF throw). Uses throw rules instead of normal knockback formula.',
  );
  assert.equal(
    getRulebookSymbolTooltipText('signature-refresh-beat'),
    'Signature Refresh beat. Refreshes like [E], but the active card goes to the top of your deck if that refresh happens.',
  );
});

test('all live card-visible symbols resolve to rulebook tooltip definitions', () => {
  const unresolved = [];

  getAllCards().forEach((card) => {
    const actions = Array.isArray(card.actions) ? card.actions : [];
    actions.forEach((action) => {
      if (!resolveRulebookSymbolTooltip(action)) {
        unresolved.push(`${card.id}: action ${action}`);
      }
    });

    const timings = Array.isArray(card.timings) ? card.timings : [];
    timings.forEach((timing) => {
      if (!timing) return;
      if (!resolveRulebookSymbolTooltip(timing)) {
        unresolved.push(`${card.id}: timing ${timing}`);
      }
    });

    [card.triggerText, card.activeText, card.passiveText].forEach((text, index) => {
      const section = index === 0 ? 'triggerText' : index === 1 ? 'activeText' : 'passiveText';
      collectInlineTokens(text).forEach((token) => {
        if (!resolveRulebookSymbolTooltip(token)) {
          unresolved.push(`${card.id}: ${section} ${token}`);
        }
      });
    });

    if (!resolveRulebookSymbolTooltip(`rot${card.rotations ?? '*'}`)) {
      unresolved.push(`${card.id}: rotation ${card.rotations ?? '*'}`);
    }
    if (!resolveRulebookSymbolTooltip('DamageIcon')) {
      unresolved.push(`${card.id}: damage badge`);
    }
    if (!resolveRulebookSymbolTooltip(card.kbf === 'T' ? 'throw kbf icon' : 'KnockBackIcon')) {
      unresolved.push(`${card.id}: kbf badge ${card.kbf}`);
    }
  });

  assert.deepEqual(unresolved, []);
});
