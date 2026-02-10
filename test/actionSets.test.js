const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyActionSetToBeats } = require('../dist/game/actionSets.js');

test('applyActionSetToBeats replaces trailing E with provided actions', () => {
  const characters = [
    { userId: 'player-a', username: 'Player A', position: { q: 1, r: 0 }, facing: 0 },
    { userId: 'player-b', username: 'Player B', position: { q: -1, r: 0 }, facing: 180 },
  ];
  const beats = [[
    { username: 'Player A', action: 'E', rotation: '', priority: 0, damage: 0, location: { q: 1, r: 0 }, facing: 0, calculated: false },
    { username: 'Player B', action: 'W', rotation: '', priority: 0, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: false },
  ],
  [
    { username: 'Player B', action: 'm', rotation: '', priority: 0, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: false },
  ],
  [
    { username: 'Player B', action: 'E', rotation: '', priority: 0, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: false },
  ],
  [
    { username: 'Player B', action: 'W', rotation: '', priority: 0, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: false },
  ]];

  const updated = applyActionSetToBeats(beats, characters, 'player-a', [
    { action: 'A', rotation: 'R1', priority: 50 },
    { action: 'B', rotation: '', priority: 40 },
  ]);

  assert.deepEqual(updated, [
    [
      { username: 'Player A', action: 'A', rotation: 'R1', priority: 50, damage: 0, location: { q: 1, r: 0 }, facing: 0, calculated: false },
      { username: 'Player B', action: 'W', rotation: '', priority: 0, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: false },
    ],
    [
      { username: 'Player A', action: 'B', rotation: '', priority: 40, damage: 0, location: { q: 1, r: 0 }, facing: 0, calculated: false },
      { username: 'Player B', action: 'm', rotation: '', priority: 0, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: false },
    ],
    [
      { username: 'Player B', action: 'E', rotation: '', priority: 0, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: false },
    ],
    [
      { username: 'Player B', action: 'W', rotation: '', priority: 0, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: false },
    ],
  ]);
});

test('applyActionSetToBeats fills the first missing beat for a player', () => {
  const characters = [
    { userId: 'player-a', username: 'Player A', position: { q: 1, r: 0 }, facing: 0 },
    { userId: 'player-b', username: 'Player B', position: { q: -1, r: 0 }, facing: 180 },
  ];
  const beats = [
    [
      { username: 'Player A', action: 'W', rotation: '', priority: 0, damage: 0, location: { q: 1, r: 0 }, facing: 0, calculated: false },
      { username: 'Player B', action: 'W', rotation: '', priority: 0, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: false },
    ],
    [
      { username: 'Player A', action: 'a', rotation: '', priority: 0, damage: 0, location: { q: 1, r: 0 }, facing: 0, calculated: false },
    ],
  ];

  const updated = applyActionSetToBeats(beats, characters, 'player-b', [
    { action: 'm', rotation: '', priority: 10 },
  ]);

  assert.deepEqual(updated[1], [
    { username: 'Player A', action: 'a', rotation: '', priority: 0, damage: 0, location: { q: 1, r: 0 }, facing: 0, calculated: false },
    { username: 'Player B', action: 'm', rotation: '', priority: 10, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: false },
  ]);
  assert.equal(updated[2], undefined);
});

test('applyActionSetToBeats replaces a focus F beat as the next open slot', () => {
  const characters = [
    { userId: 'player-a', username: 'Player A', position: { q: 1, r: 0 }, facing: 0 },
    { userId: 'player-b', username: 'Player B', position: { q: -1, r: 0 }, facing: 180 },
  ];
  const beats = [
    [
      { username: 'Player A', action: 'W', rotation: '', priority: 0, damage: 0, location: { q: 1, r: 0 }, facing: 0, calculated: false },
      { username: 'Player B', action: 'W', rotation: '', priority: 0, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: false },
    ],
    [
      { username: 'Player A', action: 'F', rotation: '', priority: 0, damage: 0, location: { q: 1, r: 0 }, facing: 0, calculated: false },
      { username: 'Player B', action: 'W', rotation: '', priority: 0, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: false },
    ],
  ];

  const updated = applyActionSetToBeats(beats, characters, 'player-a', [
    { action: 'm', rotation: '', priority: 10 },
    { action: 'E', rotation: '', priority: 0 },
  ]);

  assert.equal(updated[1][0].action, 'm');
  assert.equal(updated[2][0].action, 'E');
});
