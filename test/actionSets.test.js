const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyActionSetToBeats } = require('../dist/game/actionSets.js');

test('applyActionSetToBeats replaces trailing E and appends actions', () => {
  const characters = [
    { userId: 'player-a', username: 'Player A', position: { q: 1, r: 0 } },
    { userId: 'player-b', username: 'Player B', position: { q: -1, r: 0 } },
  ];
  const beats = [[
    { username: 'Player A', action: 'E', damage: 0, location: { q: 1, r: 0 } },
    { username: 'Player B', action: 'W', damage: 0, location: { q: -1, r: 0 } },
  ],
  [
    { username: 'Player B', action: 'm', damage: 0, location: { q: -1, r: 0 } },
  ],
  [
    { username: 'Player B', action: 'E', damage: 0, location: { q: -1, r: 0 } },
  ],
  [
    { username: 'Player B', action: 'W', damage: 0, location: { q: -1, r: 0 } },
  ]];

  const updated = applyActionSetToBeats(beats, characters, 'player-a', ['A', 'B']);

  assert.deepEqual(updated, [
    [
      { username: 'Player A', action: 'A', damage: 0, location: { q: 1, r: 0 } },
      { username: 'Player B', action: 'W', damage: 0, location: { q: -1, r: 0 } },
    ],
    [
      { username: 'Player A', action: 'B', damage: 0, location: { q: 1, r: 0 } },
      { username: 'Player B', action: 'm', damage: 0, location: { q: -1, r: 0 } },
    ],
    [
      { username: 'Player A', action: 'E', damage: 0, location: { q: 1, r: 0 } },
      { username: 'Player B', action: 'E', damage: 0, location: { q: -1, r: 0 } },
    ],
    [
      { username: 'Player B', action: 'W', damage: 0, location: { q: -1, r: 0 } },
    ],
  ]);
});
