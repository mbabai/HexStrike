const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildReplaySeedTokens } = require('../dist/game/tokenReplay.js');

test('buildReplaySeedTokens strips timeline-derived board tokens', () => {
  const source = [
    { id: 'fire:1', type: 'fire-hex', position: { q: 0, r: 0 }, facing: 0 },
    { id: 'arrow:1', type: 'arrow', position: { q: 1, r: 0 }, facing: 0 },
    { id: 'platform:1', type: 'ethereal-platform', position: { q: 2, r: 0 }, facing: 0 },
    { id: 'focus:1', type: 'focus-anchor', position: { q: 3, r: 0 }, facing: 0 },
    { id: 'map:1', type: 'scenario-obelisk', position: { q: 4, r: 0 }, facing: 0 },
  ];

  const result = buildReplaySeedTokens(source);

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'map:1');
  assert.equal(result[0].type, 'scenario-obelisk');
});

test('buildReplaySeedTokens returns cloned token positions', () => {
  const source = [
    { id: 'map:1', type: 'scenario-obelisk', position: { q: 4, r: 0 }, facing: 0 },
  ];

  const result = buildReplaySeedTokens(source);

  assert.equal(result.length, 1);
  assert.notEqual(result[0], source[0]);
  assert.notEqual(result[0].position, source[0].position);
  assert.deepEqual(result[0].position, { q: 4, r: 0 });
});

