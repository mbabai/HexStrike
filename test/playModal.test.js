const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_PLAY_MODAL_BEAT_SLOT_COUNT,
  resolvePlayModalBeatSlotIndex,
} = require('../dist/shared/game/playModal.js');

test('resolvePlayModalBeatSlotIndex follows actionSetStep when a card loops back to an earlier step', () => {
  assert.equal(resolvePlayModalBeatSlotIndex(3, 1, 1), 0);
  assert.equal(resolvePlayModalBeatSlotIndex(4, 1, 2), 1);
});

test('resolvePlayModalBeatSlotIndex follows actionSetStep when card text skips ahead in the sequence', () => {
  assert.equal(resolvePlayModalBeatSlotIndex(4, 1, 2), 1);
  assert.equal(resolvePlayModalBeatSlotIndex(6, 1, 4), 3);
});

test('resolvePlayModalBeatSlotIndex falls back to beat offset when actionSetStep is unavailable', () => {
  assert.equal(resolvePlayModalBeatSlotIndex(3, 1, null), 2);
  assert.equal(
    resolvePlayModalBeatSlotIndex(99, 1, null, DEFAULT_PLAY_MODAL_BEAT_SLOT_COUNT),
    DEFAULT_PLAY_MODAL_BEAT_SLOT_COUNT - 1,
  );
});
