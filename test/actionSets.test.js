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
      {
        username: 'Player A',
        action: 'A',
        rotation: 'R1',
        timing: ['mid'],
        priority: 50,
        actionSetStep: 1,
        damage: 0,
        location: { q: 1, r: 0 },
        facing: 0,
        calculated: false,
      },
      { username: 'Player B', action: 'W', rotation: '', priority: 0, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: false },
    ],
    [
      {
        username: 'Player A',
        action: 'B',
        rotation: '',
        timing: ['mid'],
        priority: 40,
        actionSetStep: 2,
        damage: 0,
        location: { q: 1, r: 0 },
        facing: 0,
        calculated: false,
      },
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
    {
      username: 'Player B',
      action: 'm',
      rotation: '',
      timing: ['mid'],
      priority: 10,
      actionSetStep: 1,
      damage: 0,
      location: { q: -1, r: 0 },
      facing: 180,
      calculated: false,
    },
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

test('applyActionSetToBeats preserves committed future starts while pruning stale trailing entries', () => {
  const characters = [
    { userId: 'player-a', username: 'Player A', position: { q: 1, r: 0 }, facing: 0 },
    { userId: 'player-b', username: 'Player B', position: { q: -1, r: 0 }, facing: 180 },
  ];
  const beats = [
    [
      { username: 'Player A', action: 'W', rotation: '', priority: 0, damage: 0, location: { q: 1, r: 0 }, facing: 0, calculated: true },
      { username: 'Player B', action: 'W', rotation: '', priority: 0, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: true },
    ],
    [
      { username: 'Player A', action: 'E', rotation: '', priority: 0, damage: 0, location: { q: 1, r: 0 }, facing: 0, calculated: false },
      { username: 'Player B', action: 'W', rotation: '', priority: 0, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: false },
    ],
    [
      { username: 'Player A', action: 'W', rotation: '', rotationSource: 'selected', priority: 81, damage: 0, location: { q: 1, r: 0 }, facing: 0, calculated: false, cardId: 'bow-shot' },
      { username: 'Player B', action: 'W', rotation: '', priority: 0, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: false },
    ],
    [
      { username: 'Player A', action: 'W', rotation: '0', rotationSource: 'selected', priority: 30, damage: 0, location: { q: 1, r: 0 }, facing: 0, calculated: false, cardId: 'dash' },
      { username: 'Player B', action: 'W', rotation: '', priority: 0, damage: 0, location: { q: -1, r: 0 }, facing: 180, calculated: false },
    ],
  ];

  const updated = applyActionSetToBeats(beats, characters, 'player-a', [
    { action: 'W', rotation: '', priority: 20 },
    { action: 'E', rotation: '', priority: 0 },
  ]);

  assert.equal(updated[1][0].action, 'W');
  assert.equal(updated[2][0].action, 'E');
  assert.equal(updated[3][0].action, 'W');
  assert.equal(updated[3][0].rotationSource, 'selected');
  assert.equal(updated[3][0].cardId, 'dash');
});

test('applyActionSetToBeats seeds from the open start entry state when replacing E', () => {
  const characters = [
    {
      userId: 'target',
      username: 'target',
      characterId: 'murelious',
      characterName: 'Murelious',
      position: { q: 9, r: 9 },
      facing: 180,
      damage: 99,
    },
    {
      userId: 'other',
      username: 'other',
      characterId: 'zenytha',
      characterName: 'Zenytha',
      position: { q: -1, r: 0 },
      facing: 0,
      damage: 0,
    },
  ];

  const beats = [
    [
      {
        username: 'target',
        action: 'E',
        rotation: '',
        priority: 0,
        damage: 0,
        location: { q: 0, r: 0 },
        terrain: 'land',
        facing: 60,
        calculated: false,
      },
      {
        username: 'other',
        action: 'E',
        rotation: '',
        priority: 0,
        damage: 0,
        location: { q: -1, r: 0 },
        terrain: 'land',
        facing: 0,
        calculated: false,
      },
    ],
  ];

  const actionList = [
    {
      action: 'm',
      rotation: '0',
      priority: 10,
      damage: 0,
      kbf: 0,
      cardId: 'step',
      passiveCardId: 'step',
      rotationSource: 'selected',
    },
  ];

  const updated = applyActionSetToBeats(beats, characters, 'target', actionList);
  const targetEntry = updated[0].find((entry) => entry.username === 'target');
  assert.ok(targetEntry);
  assert.deepEqual(targetEntry.location, { q: 0, r: 0 });
  assert.equal(targetEntry.damage, 0);
  assert.equal(targetEntry.facing, 60);
});
