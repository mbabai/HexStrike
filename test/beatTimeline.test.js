const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getCharactersAtEarliestE, getTimelineEarliestEIndex } = require('../dist/game/beatTimeline.js');

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
