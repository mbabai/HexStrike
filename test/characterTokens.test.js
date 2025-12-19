const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(join(process.cwd(), 'public', 'game', 'characterTokens.mjs')).href;

test('character token metrics account for border overlap', async () => {
  const { CHARACTER_TOKEN_STYLE, getCharacterTokenMetrics } = await import(moduleUrl);
  const size = 100;
  const metrics = getCharacterTokenMetrics(size);

  const expectedRadius = size * CHARACTER_TOKEN_STYLE.radiusFactor;
  const expectedBorder = Math.max(1.5, expectedRadius * CHARACTER_TOKEN_STYLE.borderFactor);
  const expectedTip = expectedRadius * CHARACTER_TOKEN_STYLE.arrowTipFactor - expectedBorder;
  const expectedBase = expectedRadius * CHARACTER_TOKEN_STYLE.arrowBaseFactor - expectedBorder;

  assert.ok(Math.abs(metrics.radius - expectedRadius) < 1e-6);
  assert.ok(Math.abs(metrics.borderWidth - expectedBorder) < 1e-6);
  assert.ok(Math.abs(metrics.arrow.tip - expectedTip) < 1e-6);
  assert.ok(Math.abs(metrics.arrow.base - expectedBase) < 1e-6);
});

test('facing arrow points reflect direction', async () => {
  const { getCharacterTokenMetrics, getFacingArrowPoints } = await import(moduleUrl);
  const metrics = getCharacterTokenMetrics(100);

  const left = getFacingArrowPoints(0, 0, metrics, 0);
  assert.ok(left.tip.x < left.baseTop.x);
  assert.equal(left.baseTop.x, left.baseBottom.x);
  assert.ok(left.baseTop.x < 0);

  const right = getFacingArrowPoints(0, 0, metrics, 180);
  assert.ok(right.tip.x > right.baseTop.x);
  assert.equal(right.baseTop.x, right.baseBottom.x);
  assert.ok(right.baseTop.x > 0);
});
