const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findTimelineBreaks, repairTimelineBreaksFromBaseline } = require('../dist/game/timelineIntegrity.js');

const buildEntry = (username, action, rotationSource, calculated = false) => ({
  username,
  action,
  rotation: '',
  rotationSource,
  priority: 10,
  damage: 0,
  location: { q: 0, r: 0 },
  facing: 180,
  calculated,
});

test('findTimelineBreaks flags open beats before protected starts', () => {
  const characters = [{ userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180 }];
  const beats = [
    [buildEntry('alpha', 'W', '', true)],
    [buildEntry('alpha', 'E', '')],
    [buildEntry('alpha', 'W', 'selected')],
  ];

  const issues = findTimelineBreaks({
    beats,
    characters,
    interactions: [],
    resolvedIndex: 0,
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0].userId, 'alpha');
  assert.equal(issues[0].beatIndex, 1);
  assert.equal(issues[0].protectedStartIndex, 2);
  assert.equal(issues[0].breakKind, 'open');
});

test('repairTimelineBreaksFromBaseline restores non-open entries before protected starts', () => {
  const characters = [{ userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180 }];
  const baselineBeats = [
    [buildEntry('alpha', 'W', '', true)],
    [buildEntry('alpha', 'DamageIcon', '')],
    [buildEntry('alpha', 'W', 'selected')],
  ];
  const beats = [
    [buildEntry('alpha', 'W', '', true)],
    [buildEntry('alpha', 'E', '')],
    [buildEntry('alpha', 'W', 'selected')],
  ];

  const repairs = repairTimelineBreaksFromBaseline({
    beats,
    baselineBeats,
    characters,
    interactions: [],
    resolvedIndex: 0,
  });

  assert.equal(repairs.length, 1);
  assert.equal(repairs[0].beatIndex, 1);
  assert.equal(repairs[0].restoredAction, 'DamageIcon');
  assert.equal(beats[1][0].action, 'DamageIcon');

  const remaining = findTimelineBreaks({
    beats,
    characters,
    interactions: [],
    resolvedIndex: 0,
  });
  assert.equal(remaining.length, 0);
});

test('repairTimelineBreaksFromBaseline restores missing entries before protected starts', () => {
  const characters = [{ userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180 }];
  const baselineBeats = [
    [buildEntry('alpha', 'W', '', true)],
    [buildEntry('alpha', 'DamageIcon', '')],
    [buildEntry('alpha', 'W', 'selected')],
  ];
  const beats = [
    [buildEntry('alpha', 'W', '', true)],
    [],
    [buildEntry('alpha', 'W', 'selected')],
  ];

  const repairs = repairTimelineBreaksFromBaseline({
    beats,
    baselineBeats,
    characters,
    interactions: [],
    resolvedIndex: 0,
  });

  assert.equal(repairs.length, 1);
  assert.equal(repairs[0].replacedAction, null);
  assert.equal(beats[1][0].action, 'DamageIcon');
});
