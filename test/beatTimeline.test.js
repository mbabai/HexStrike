const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getCharacterFirstEIndex, getCharactersAtEarliestE, getTimelineEarliestEIndex } = require('../dist/game/beatTimeline.js');

test('getTimelineEarliestEIndex finds the earliest shared open beat', () => {
  const characters = [
    { userId: 'player-a', username: 'Player A' },
    { userId: 'player-b', username: 'Player B' },
  ];
  const beats = [
    [
      { username: 'Player A', action: 'W' },
      { username: 'Player B', action: 'W' },
    ],
    [
      { username: 'Player A', action: 'E' },
      { username: 'Player B', action: 'W' },
    ],
    [
      { username: 'Player B', action: 'E' },
    ],
  ];

  assert.equal(getTimelineEarliestEIndex(beats, characters), 1);
});

test('getCharactersAtEarliestE returns only players at the earliest E', () => {
  const characters = [
    { userId: 'player-a', username: 'Player A' },
    { userId: 'player-b', username: 'Player B' },
    { userId: 'player-c', username: 'Player C' },
  ];
  const beats = [
    [
      { username: 'Player A', action: 'W' },
      { username: 'Player B', action: 'E' },
      { username: 'Player C', action: 'W' },
    ],
    [
      { username: 'Player A', action: 'E' },
      { username: 'Player C', action: 'E' },
    ],
  ];

  const atBat = getCharactersAtEarliestE(beats, characters).map((character) => character.userId);
  assert.deepEqual(atBat, ['player-b']);
});

test('earliest E ignores calculated history entries', () => {
  const characters = [
    { userId: 'def', username: 'Def' },
    { userId: 'atk', username: 'Atk' },
  ];
  const beats = [
    [
      { username: 'Def', action: '[b]', calculated: true },
      { username: 'Atk', action: 'a', calculated: true },
    ],
    [
      { username: 'Def', action: 'E', calculated: true },
      { username: 'Atk', action: 'DamageIcon', calculated: true },
    ],
    [
      { username: 'Atk', action: 'DamageIcon', calculated: false },
    ],
    [
      { username: 'Atk', action: 'E', calculated: false },
    ],
  ];

  assert.equal(getCharacterFirstEIndex(beats, characters[0]), 2);
  assert.equal(getCharacterFirstEIndex(beats, characters[1]), 3);
  assert.equal(getTimelineEarliestEIndex(beats, characters), 2);
  const atBat = getCharactersAtEarliestE(beats, characters).map((character) => character.userId);
  assert.deepEqual(atBat, ['def']);
});
