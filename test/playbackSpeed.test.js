const { test } = require('node:test');
const assert = require('node:assert/strict');

const loadModule = async () => import('../public/game/playbackSpeed.mjs');

const assertApprox = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${expected}, got ${actual}`);
};

test('getStepProgressByChannel keeps all channels equal at 1x speed', async () => {
  const { getStepProgressByChannel } = await loadModule();
  const result = getStepProgressByChannel(0.42, 1);
  assertApprox(result.movement, 0.42);
  assertApprox(result.rotation, 0.42);
  assertApprox(result.attack, 0.42);
});

test('getStepProgressByChannel scales movement/rotation fully and attack at half-rate', async () => {
  const { getStepProgressByChannel } = await loadModule();
  const result = getStepProgressByChannel(0.4, 2);
  assertApprox(result.movement, 0.8);
  assertApprox(result.rotation, 0.8);
  assertApprox(result.attack, 0.6);
});

test('getStepProgressByChannel clamps channel progress to 1', async () => {
  const { getStepProgressByChannel } = await loadModule();
  const result = getStepProgressByChannel(0.6, 3);
  assert.equal(result.movement, 1);
  assert.equal(result.rotation, 1);
  assert.equal(result.attack, 1);
});

test('getInterpolatedFacing uses shortest-angle interpolation across 0/360', async () => {
  const { getInterpolatedFacing } = await loadModule();
  assertApprox(getInterpolatedFacing(350, 10, 0.5), 0);
  assertApprox(getInterpolatedFacing(10, 350, 0.5), 0);
});

test('getInterpolatedFacing clamps progress and returns target when progress is >= 1', async () => {
  const { getInterpolatedFacing } = await loadModule();
  assertApprox(getInterpolatedFacing(120, 300, 1.5), 300);
});
