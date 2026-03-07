const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createFirePriorityPlacementTracker,
  getCommittedRotationDirectionKey,
  getTokenPlacementWindowKey,
} = require('../dist/game/boardTokens.js');

test('getCommittedRotationDirectionKey maps rotation labels to local directions', () => {
  assert.equal(getCommittedRotationDirectionKey(''), 'F');
  assert.equal(getCommittedRotationDirectionKey('R1'), 'R');
  assert.equal(getCommittedRotationDirectionKey('R2'), 'BR');
  assert.equal(getCommittedRotationDirectionKey('3'), 'B');
  assert.equal(getCommittedRotationDirectionKey('L2'), 'BL');
  assert.equal(getCommittedRotationDirectionKey('L1'), 'L');
});

test('createFirePriorityPlacementTracker clears fire priority when the placement window changes', () => {
  const tracker = createFirePriorityPlacementTracker();

  tracker.setWindow('mid');
  tracker.noteFirePlacement('0,0');
  assert.equal(tracker.fireWinsAt('0,0'), true);

  tracker.setWindow('mid');
  assert.equal(tracker.fireWinsAt('0,0'), true);

  tracker.setWindow('late');
  assert.equal(tracker.fireWinsAt('0,0'), false);
});

test('getTokenPlacementWindowKey uses timing phases and falls back for untimed actions', () => {
  assert.equal(getTokenPlacementWindowKey('X1', ['late'], 'fallback'), 'late');
  assert.equal(getTokenPlacementWindowKey('W', null, 'fallback'), 'fallback');
});
