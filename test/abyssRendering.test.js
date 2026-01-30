const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(join(process.cwd(), 'public', 'game', 'abyssRendering.mjs')).href;

test('buildAbyssPathLabels labels steps beyond the nearest land', async () => {
  const { buildAbyssPathLabels } = await import(moduleUrl);
  const land = [{ q: 0, r: 0 }];
  const characters = [
    { position: { q: 0, r: 2 } },
    { position: { q: 1, r: 0 } },
  ];

  const labels = buildAbyssPathLabels(characters, land);

  assert.equal(labels.get('0,1'), 1);
  assert.equal(labels.get('0,2'), 2);
  assert.equal(labels.has('1,0'), false);
});

test('getAbyssBorderMetrics clamps width and alpha by distance', async () => {
  const { getAbyssBorderMetrics } = await import(moduleUrl);
  const base = 10;
  const min = 2;

  const near = getAbyssBorderMetrics(0, base, min);
  assert.ok(Math.abs(near.width - base) < 1e-6);
  assert.ok(Math.abs(near.alpha - 1) < 1e-6);

  const far = getAbyssBorderMetrics(100, base, min);
  assert.ok(far.width >= min);
  assert.ok(far.alpha <= 0.001);
});
