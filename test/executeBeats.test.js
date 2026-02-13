const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executeBeats, executeBeatsWithInteractions } = require('../dist/game/execute.js');
const { applyActionSetToBeats } = require('../dist/game/actionSets.js');
const { getCharactersAtEarliestE, getTimelineEarliestEIndex } = require('../dist/game/beatTimeline.js');

const buildEntry = (username, action, priority, position, facing, rotation = '', attackDamage = 0, attackKbf = 0) => ({
  username,
  action,
  rotation,
  priority,
  damage: 0,
  location: { q: position.q, r: position.r },
  facing,
  calculated: false,
  attackDamage,
  attackKbf,
});

test('executeBeats does not inject placeholder entries for missing characters', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];

  assert.equal(beat0.length, 1);
  assert.ok(beat0.find((entry) => entry.username === 'alpha'));
  assert.equal(beat0.some((entry) => entry.username === 'beta'), false);
});

test('executeBeats applies rotations before action resolution even when disabled', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', '1a', 20, characters[0].position, characters[0].facing, '', 2, 1),
      buildEntry('beta', '1m', 0, characters[1].position, characters[1].facing, 'R1', 0, 0),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const betaEntry = beat0.find((entry) => entry.username === 'beta');

  assert.ok(betaEntry);
  assert.equal(betaEntry.location.q, 2);
  assert.equal(betaEntry.location.r, 0);
  assert.equal(betaEntry.facing, 240);
});

test('executeBeats skips combo choice on missed attacks and keeps Co symbol', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 3, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', '1a', 20, characters[0].position, characters[0].facing, '', 2, 0),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'Co', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat1 = result.beats[1] || [];
  const alphaEntry = beat1.find((entry) => entry.username === 'alpha');

  assert.ok(alphaEntry);
  assert.equal(alphaEntry.action, 'Co');
  assert.equal(alphaEntry.comboSkipped, true);
  assert.equal(result.interactions.some((interaction) => interaction.type === 'combo'), false);
});

test('executeBeatsWithInteractions does not let combo replay overwrite DamageIcon and swallow a submitted start', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: -1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'a', 90, characters[0].position, characters[0].facing, '', 6, 4),
      buildEntry('beta', 'DamageIcon', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'DamageIcon', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'DamageIcon', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'E', 0, characters[1].position, characters[1].facing),
    ],
  ];
  beats[0][0].cardId = 'hammer';
  beats[0][1].cardId = 'jab';
  beats[0][1].passiveCardId = 'step';

  const submittedBeats = applyActionSetToBeats(
    beats,
    characters,
    'beta',
    [
      {
        action: 'W',
        rotation: '0',
        rotationSource: 'selected',
        priority: 15,
        damage: 0,
        kbf: 0,
        cardId: 'advance',
        passiveCardId: 'tackle',
      },
      {
        action: 'E',
        rotation: '',
        priority: 15,
        damage: 0,
        kbf: 0,
        cardId: 'advance',
        passiveCardId: 'tackle',
      },
    ],
    [{ type: 'action-set', activeCardId: 'advance', passiveCardId: 'tackle', rotation: '0' }],
  );

  const interactions = [
    {
      id: 'combo:0:beta:beta',
      type: 'combo',
      beatIndex: 0,
      actorUserId: 'beta',
      targetUserId: 'beta',
      status: 'resolved',
      resolution: { continue: false },
    },
  ];

  const result = executeBeatsWithInteractions(submittedBeats, characters, interactions);
  const betaBeat3 = (result.beats[3] || []).find((entry) => entry.username === 'beta');
  const betaBeat4 = (result.beats[4] || []).find((entry) => entry.username === 'beta');

  assert.ok(betaBeat3);
  assert.equal(betaBeat3.action, 'W');
  assert.equal(betaBeat3.rotation, '0');
  assert.equal(betaBeat3.rotationSource, 'selected');
  assert.ok(betaBeat4);
  assert.equal(betaBeat4.action, 'E');
});

test('executeBeats preserves committed future action-set starts when hit timeline is replayed', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: -1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'a', 90, characters[0].position, characters[0].facing, '', 6, 2),
      buildEntry('beta', 'W', 10, characters[1].position, characters[1].facing),
    ],
    [buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing)],
    [buildEntry('beta', 'W', 15, characters[1].position, characters[1].facing, '0', 0, 0)],
  ];
  beats[2][0].rotationSource = 'selected';
  beats[2][0].cardId = 'advance';
  beats[2][0].passiveCardId = 'tackle';

  const result = executeBeats(beats, characters);
  const betaBeat2 = (result.beats[2] || []).find((entry) => entry.username === 'beta');

  assert.ok(betaBeat2);
  assert.equal(betaBeat2.action, 'W');
  assert.equal(betaBeat2.rotationSource, 'selected');
  assert.equal(betaBeat2.cardId, 'advance');
  assert.equal(betaBeat2.passiveCardId, 'tackle');
});

test('executeBeats keeps terminal DamageIcon when hit replay is truncated by a committed future start', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: -1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'a', 90, characters[0].position, characters[0].facing, '', 6, 2),
      buildEntry('beta', 'W', 95, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'DamageIcon', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 15, characters[1].position, characters[1].facing, '0', 0, 0),
    ],
  ];
  beats[2][1].rotationSource = 'selected';
  beats[2][1].cardId = 'advance';
  beats[2][1].passiveCardId = 'tackle';

  const result = executeBeats(beats, characters);
  const betaBeat1 = (result.beats[1] || []).find((entry) => entry.username === 'beta');
  const betaBeat2 = (result.beats[2] || []).find((entry) => entry.username === 'beta');

  assert.ok(betaBeat1);
  assert.equal(betaBeat1.action, 'DamageIcon');
  assert.ok(betaBeat2);
  assert.equal(betaBeat2.action, 'W');
  assert.equal(betaBeat2.rotationSource, 'selected');
  assert.equal(betaBeat2.cardId, 'advance');
});

test('executeBeats does not open combo on throw hits', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', '[a]', 20, characters[0].position, characters[0].facing, '', 2, 0),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'Co', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  beats[0][0].interaction = { type: 'throw' };
  beats[0][0].cardId = 'throw-card';
  beats[1][0].cardId = 'throw-card';

  const result = executeBeats(beats, characters);
  assert.equal(result.interactions.some((interaction) => interaction.type === 'combo'), false);
});

test('executeBeats opens a guard continue interaction on Guard bracket frames', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', '[b-Lb-Rb]', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'b-Lb-Rb', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];
  beats[1][0].cardId = 'guard';
  beats[2][0].cardId = 'guard';
  beats[3][0].cardId = 'guard';

  const result = executeBeats(beats, characters);
  const guardContinue = result.interactions.find((interaction) => interaction.type === 'guard-continue');

  assert.ok(guardContinue);
  assert.equal(guardContinue.status, 'pending');
  assert.equal(guardContinue.actorUserId, 'alpha');
  assert.equal(guardContinue.beatIndex, 1);
  assert.equal(result.lastCalculated, 1);
});

test('executeBeatsWithInteractions forces a discard on Guard E after continue', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', '[b-Lb-Rb]', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'b-Lb-Rb', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];
  beats[1][0].cardId = 'guard';
  beats[2][0].cardId = 'guard';
  beats[3][0].cardId = 'guard';

  const interactions = [
    {
      id: 'guard-continue:1:alpha:alpha',
      type: 'guard-continue',
      beatIndex: 1,
      actorUserId: 'alpha',
      targetUserId: 'alpha',
      status: 'resolved',
      resolution: { continue: true },
    },
  ];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const discard = result.interactions.find(
    (interaction) => interaction.type === 'discard' && interaction.actorUserId === 'alpha' && interaction.beatIndex === 3,
  );
  const alphaBeat3 = (result.beats[3] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat4 = (result.beats[4] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat5 = (result.beats[5] || []).find((entry) => entry.username === 'alpha');

  assert.ok(discard);
  assert.equal(discard.status, 'pending');
  assert.equal(discard.discardCount, 1);
  assert.ok(alphaBeat3);
  assert.ok(alphaBeat4);
  assert.ok(alphaBeat5);
  assert.equal(alphaBeat3.action, '[b-Lb-Rb]');
  assert.equal(alphaBeat4.action, 'b-Lb-Rb');
  assert.equal(alphaBeat5.action, 'E');
});

test('executeBeatsWithInteractions loops Guard when the trailing E is implicit', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', '[b-Lb-Rb]', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'b-Lb-Rb', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing)],
  ];
  beats[1][0].cardId = 'guard';
  beats[2][0].cardId = 'guard';

  const interactions = [
    {
      id: 'guard-continue:1:alpha:alpha',
      type: 'guard-continue',
      beatIndex: 1,
      actorUserId: 'alpha',
      targetUserId: 'alpha',
      status: 'resolved',
      resolution: { continue: true },
    },
  ];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const discard = result.interactions.find(
    (interaction) => interaction.type === 'discard' && interaction.actorUserId === 'alpha' && interaction.beatIndex === 3,
  );
  const alphaBeat3 = (result.beats[3] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat4 = (result.beats[4] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat5 = (result.beats[5] || []).find((entry) => entry.username === 'alpha');

  assert.ok(discard);
  assert.equal(discard.status, 'pending');
  assert.equal(discard.discardCount, 1);
  assert.ok(alphaBeat3);
  assert.ok(alphaBeat4);
  assert.ok(alphaBeat5);
  assert.equal(alphaBeat3.action, '[b-Lb-Rb]');
  assert.equal(alphaBeat4.action, 'b-Lb-Rb');
  assert.equal(alphaBeat5.action, 'E');
});

test('executeBeatsWithInteractions applies Guard block on repeated implicit-E frames', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', '[b-Lb-Rb]', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'b-Lb-Rb', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [buildEntry('beta', 'a', 10, characters[1].position, characters[1].facing, '', 3, 1)],
  ];
  beats[1][0].cardId = 'guard';
  beats[2][0].cardId = 'guard';

  const interactions = [
    {
      id: 'guard-continue:1:alpha:alpha',
      type: 'guard-continue',
      beatIndex: 1,
      actorUserId: 'alpha',
      targetUserId: 'alpha',
      status: 'resolved',
      resolution: { continue: true },
    },
  ];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const alphaBeat3 = (result.beats[3] || []).find((entry) => entry.username === 'alpha');

  assert.ok(alphaBeat3);
  assert.equal(alphaBeat3.action, '[b-Lb-Rb]');
  assert.equal(alphaBeat3.damage, 0);
  assert.equal(Array.isArray(alphaBeat3.consequences), false);
});

test('executeBeatsWithInteractions re-prompts Guard on repeated start frames at resolved index', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', '[b-Lb-Rb]', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'b-Lb-Rb', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', '[b-Lb-Rb]', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [buildEntry('alpha', 'b-Lb-Rb', 20, characters[0].position, characters[0].facing)],
    [buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing)],
  ];
  beats[1][0].cardId = 'guard';
  beats[2][0].cardId = 'guard';
  beats[3][0].cardId = 'guard';
  beats[4][0].cardId = 'guard';
  beats[5][0].cardId = 'guard';
  beats.slice(0, 4).forEach((beat) => beat.forEach((entry) => { entry.calculated = true; }));

  const interactions = [
    {
      id: 'guard-continue:1:alpha:alpha',
      type: 'guard-continue',
      beatIndex: 1,
      actorUserId: 'alpha',
      targetUserId: 'alpha',
      status: 'resolved',
      resolution: { continue: true, guardRepeatApplied: true, guardRepeatBeatIndex: 3 },
    },
    {
      id: 'discard:3:alpha:alpha',
      type: 'discard',
      beatIndex: 3,
      actorUserId: 'alpha',
      targetUserId: 'alpha',
      status: 'resolved',
      discardCount: 1,
    },
  ];

  const guardContinueAvailability = new Map([['alpha', true]]);
  const result = executeBeatsWithInteractions(
    beats,
    characters,
    interactions,
    undefined,
    undefined,
    [],
    undefined,
    guardContinueAvailability,
  );
  const repeatedPrompt = result.interactions.find(
    (interaction) =>
      interaction.type === 'guard-continue' &&
      interaction.beatIndex === 3 &&
      interaction.actorUserId === 'alpha' &&
      interaction.status === 'pending',
  );

  assert.ok(repeatedPrompt);
  assert.equal(result.lastCalculated, 3);
});

test('executeBeatsWithInteractions does not prompt Guard repeat when no cards are available to discard', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', '[b-Lb-Rb]', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'b-Lb-Rb', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', '[b-Lb-Rb]', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [buildEntry('alpha', 'b-Lb-Rb', 20, characters[0].position, characters[0].facing)],
    [buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing)],
  ];
  beats[1][0].cardId = 'guard';
  beats[2][0].cardId = 'guard';
  beats[3][0].cardId = 'guard';
  beats[4][0].cardId = 'guard';
  beats[5][0].cardId = 'guard';
  beats.slice(0, 4).forEach((beat) => beat.forEach((entry) => { entry.calculated = true; }));

  const interactions = [
    {
      id: 'guard-continue:1:alpha:alpha',
      type: 'guard-continue',
      beatIndex: 1,
      actorUserId: 'alpha',
      targetUserId: 'alpha',
      status: 'resolved',
      resolution: { continue: true, guardRepeatApplied: true, guardRepeatBeatIndex: 3 },
    },
    {
      id: 'discard:3:alpha:alpha',
      type: 'discard',
      beatIndex: 3,
      actorUserId: 'alpha',
      targetUserId: 'alpha',
      status: 'resolved',
      discardCount: 1,
    },
  ];

  const guardContinueAvailability = new Map([['alpha', false]]);
  const result = executeBeatsWithInteractions(
    beats,
    characters,
    interactions,
    undefined,
    undefined,
    [],
    undefined,
    guardContinueAvailability,
  );
  const repeatedPrompt = result.interactions.find(
    (interaction) =>
      interaction.type === 'guard-continue' &&
      interaction.beatIndex === 3 &&
      interaction.actorUserId === 'alpha' &&
      interaction.status === 'pending',
  );

  assert.equal(Boolean(repeatedPrompt), false);
});

test('executeBeats treats Grappling Hook as a throw only when starting on land with an adjacent target', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', '[3c]', 20, characters[0].position, characters[0].facing, '', 1, 0),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  beats[0][0].cardId = 'grappling-hook';

  const result = executeBeats(beats, characters);

  assert.ok(result.interactions.some((interaction) => interaction.type === 'throw'));
});

test('executeBeats keeps Grappling Hook as a normal charge hit on land when the target is not adjacent', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 2, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 4, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', '[3c]', 20, characters[0].position, characters[0].facing, '', 2, 0),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  beats[0][0].cardId = 'grappling-hook';

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const alphaEntry = beat0.find((entry) => entry.username === 'alpha');
  const betaEntry = beat0.find((entry) => entry.username === 'beta');

  assert.equal(result.interactions.some((interaction) => interaction.type === 'throw'), false);
  assert.ok(alphaEntry);
  assert.equal(alphaEntry.location.q, 3);
  assert.equal(alphaEntry.location.r, 0);
  assert.ok(betaEntry);
  assert.equal(betaEntry.action, 'W');
  assert.equal(betaEntry.damage, 2);
});

test('executeBeats keeps Grappling Hook as a normal hit when starting on abyss', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: -4, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: -3, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', '[3c]', 20, characters[0].position, characters[0].facing, '', 1, 0),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  beats[0][0].cardId = 'grappling-hook';

  const result = executeBeats(beats, characters);

  assert.equal(result.interactions.some((interaction) => interaction.type === 'throw'), false);
});

test('executeBeats clamps Grappling Hook charge to the first land tile ahead across abyss gaps', () => {
  const cases = [
    { startQ: -3, expectedQ: -2 },
    { startQ: -4, expectedQ: -2 },
    { startQ: -5, expectedQ: -2 },
  ];

  cases.forEach(({ startQ, expectedQ }) => {
    const characters = [
      { userId: 'alpha', username: 'alpha', position: { q: startQ, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
      { userId: 'beta', username: 'beta', position: { q: 3, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
    ];

    const beats = [
      [
        buildEntry('alpha', '[3c]', 20, characters[0].position, characters[0].facing, '', 0, 0),
        buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
      ],
    ];

    beats[0][0].cardId = 'grappling-hook';

    const result = executeBeats(beats, characters);
    const beat0 = result.beats[0] || [];
    const alphaEntry = beat0.find((entry) => entry.username === 'alpha');

    assert.ok(alphaEntry);
    assert.equal(alphaEntry.location.q, expectedQ);
    assert.equal(alphaEntry.location.r, 0);
  });
});

test('executeBeats flips targets for Grappling Hook passive hits', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'a', 20, characters[0].position, characters[0].facing, '', 2, 1),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  beats[0][0].passiveCardId = 'grappling-hook';

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const betaEntry = beat0.find((entry) => entry.username === 'beta');

  assert.ok(betaEntry);
  assert.equal(betaEntry.location.q, -2);
  assert.equal(betaEntry.location.r, 0);
});

test('executeBeats preserves action when hit after acting and records consequences', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', '1a', 5, characters[1].position, characters[1].facing, '', 2, 1),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const alphaEntry = beat0.find((entry) => entry.username === 'alpha');

  assert.ok(alphaEntry);
  assert.equal(alphaEntry.action, 'W');
  assert.ok(Array.isArray(alphaEntry.consequences));
  assert.deepEqual(alphaEntry.consequences[0], { type: 'hit', damageDelta: 2, knockbackDistance: 1 });

  const beat1 = result.beats[1] || [];
  const alphaBeat1 = beat1.find((entry) => entry.username === 'alpha');
  assert.ok(alphaBeat1);
  assert.equal(alphaBeat1.action, 'DamageIcon');
});

test('executeBeats applies each hit in a multi-token attack in the same beat', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'a-2a', 67, characters[0].position, characters[0].facing, '', 3, 2),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const betaEntry = beat0.find((entry) => entry.username === 'beta');
  const hitConsequences = (betaEntry?.consequences ?? []).filter((effect) => effect?.type === 'hit');

  assert.ok(betaEntry);
  assert.equal(betaEntry.damage, 6);
  assert.equal(betaEntry.location.q, 3);
  assert.equal(betaEntry.location.r, 0);
  assert.equal(hitConsequences.length, 2);
  assert.deepEqual(hitConsequences[0], { type: 'hit', damageDelta: 3, knockbackDistance: 1 });
  assert.deepEqual(hitConsequences[1], { type: 'hit', damageDelta: 3, knockbackDistance: 1 });
});

test('executeBeats preserves rotations when hit overrides the action', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', '1a', 20, characters[0].position, characters[0].facing, '', 2, 1),
      buildEntry('beta', '1m', 0, characters[1].position, characters[1].facing, 'R1', 0, 0),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const betaEntry = beat0.find((entry) => entry.username === 'beta');

  assert.ok(betaEntry);
  assert.equal(betaEntry.action, 'DamageIcon');
  assert.equal(betaEntry.rotation, 'R1');
  assert.equal(betaEntry.facing, 240);
});

test('executeBeats stops multi-step movement before occupied hexes', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 2, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', '3m', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const alphaEntry = beat0.find((entry) => entry.username === 'alpha');

  assert.ok(alphaEntry);
  assert.equal(alphaEntry.location.q, 1);
  assert.equal(alphaEntry.location.r, 0);
});

test('executeBeats stops multi-step charges before occupied hexes', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 2, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', '3c', 20, characters[0].position, characters[0].facing, '', 0, 0),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const alphaEntry = beat0.find((entry) => entry.username === 'alpha');

  assert.ok(alphaEntry);
  assert.equal(alphaEntry.location.q, 1);
  assert.equal(alphaEntry.location.r, 0);
});

test('executeBeats spawns a bow shot arrow on X1', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
  ];

  const beats = [[buildEntry('alpha', 'X1', 20, characters[0].position, characters[0].facing)]];
  beats[0][0].cardId = 'bow-shot';
  beats[0][0].passiveCardId = 'step';

  const result = executeBeats(beats, characters);
  const tokens = result.boardTokens || [];

  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].type, 'arrow');
  assert.deepEqual(tokens[0].position, { q: 1, r: 0 });
  assert.equal(tokens[0].facing, 180);
});

test('executeBeats moves bow shot arrows and applies damage on hit', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 2, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'X1', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];
  beats[0][0].cardId = 'bow-shot';
  beats[0][0].passiveCardId = 'step';

  const result = executeBeats(beats, characters);
  const beat1 = result.beats[1] || [];
  const betaEntry = beat1.find((entry) => entry.username === 'beta');

  assert.ok(betaEntry);
  assert.equal(betaEntry.damage, 4);
  assert.equal((result.boardTokens || []).length, 0);
});

test('executeBeats resolves existing arrows before movement actions', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
  ];
  const beats = [[buildEntry('alpha', 'm', 20, characters[0].position, characters[0].facing)]];
  const boardTokens = [
    { id: 'arrow:0', type: 'arrow', position: { q: 1, r: 0 }, facing: 0, ownerUserId: 'beta' },
  ];

  const result = executeBeats(beats, characters, undefined, boardTokens);
  const beat0 = result.beats[0] || [];
  const alphaEntry = beat0.find((entry) => entry.username === 'alpha');

  assert.ok(alphaEntry);
  assert.equal(alphaEntry.action, 'DamageIcon');
  assert.equal(alphaEntry.damage, 4);
  assert.equal((result.boardTokens || []).length, 0);
});

test('executeBeats applies arrow hits when long movement passes through an arrow hex', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
  ];
  const beats = [[buildEntry('alpha', '2m', 20, characters[0].position, characters[0].facing)]];
  const boardTokens = [
    { id: 'arrow:0', type: 'arrow', position: { q: 2, r: 0 }, facing: 0, ownerUserId: 'beta' },
  ];

  const result = executeBeats(beats, characters, undefined, boardTokens);
  const beat0 = result.beats[0] || [];
  const alphaEntry = beat0.find((entry) => entry.username === 'alpha');

  assert.ok(alphaEntry);
  assert.equal(alphaEntry.action, 'DamageIcon');
  assert.equal(alphaEntry.damage, 4);
  assert.equal((result.boardTokens || []).length, 0);
});

test('executeBeats lets long jumps pass over arrow hexes without taking damage', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
  ];
  const beats = [[buildEntry('alpha', '2j', 20, characters[0].position, characters[0].facing)]];
  const boardTokens = [
    { id: 'arrow:0', type: 'arrow', position: { q: 2, r: 0 }, facing: 0, ownerUserId: 'beta' },
  ];

  const result = executeBeats(beats, characters, undefined, boardTokens);
  const beat0 = result.beats[0] || [];
  const alphaEntry = beat0.find((entry) => entry.username === 'alpha');
  const arrows = (result.boardTokens || []).filter((token) => token.type === 'arrow');

  assert.ok(alphaEntry);
  assert.equal(alphaEntry.action, '2j');
  assert.equal(alphaEntry.damage, 0);
  assert.deepEqual(alphaEntry.location, { q: 2, r: 0 });
  assert.equal(arrows.length, 1);
  assert.deepEqual(arrows[0].position, { q: 1, r: 0 });
});

test('executeBeats still hits jumps that land on an arrow destination', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
  ];
  const beats = [[buildEntry('alpha', '2j', 20, characters[0].position, characters[0].facing)]];
  const boardTokens = [
    { id: 'arrow:0', type: 'arrow', position: { q: 1, r: 0 }, facing: 180, ownerUserId: 'beta' },
  ];

  const result = executeBeats(beats, characters, undefined, boardTokens);
  const beat0 = result.beats[0] || [];
  const alphaEntry = beat0.find((entry) => entry.username === 'alpha');

  assert.ok(alphaEntry);
  assert.equal(alphaEntry.action, 'DamageIcon');
  assert.equal(alphaEntry.damage, 4);
  assert.equal((result.boardTokens || []).length, 0);
});

test('executeBeats blocks bow shot arrows when the target blocks the incoming direction', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('beta', 'b', 20, characters[1].position, characters[1].facing),
      buildEntry('alpha', 'X1', 0, characters[0].position, characters[0].facing),
    ],
  ];
  beats[0][1].cardId = 'bow-shot';
  beats[0][1].passiveCardId = 'step';

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const betaEntry = beat0.find((entry) => entry.username === 'beta');

  assert.ok(betaEntry);
  assert.equal(betaEntry.damage, 0);
  const hit = (betaEntry.consequences || []).find((item) => item?.type === 'hit');
  assert.equal(Boolean(hit), false);
});

test('executeBeats queues Absorb draws when a bracketed block stops damage', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('beta', '[b-Lb-Rb]', 20, characters[1].position, characters[1].facing),
      buildEntry('alpha', 'a', 0, characters[0].position, characters[0].facing, '', 3, 0),
    ],
  ];

  beats[0][0].cardId = 'absorb';
  beats[0][0].passiveCardId = 'step';
  beats[0][1].cardId = 'strike';
  beats[0][1].passiveCardId = 'step';

  const result = executeBeats(beats, characters);
  const draw = (result.interactions || []).find(
    (interaction) => interaction.type === 'draw' && interaction.actorUserId === 'beta',
  );

  assert.ok(draw);
  assert.equal(draw.drawCount, 3);
});

test('executeBeats queues Absorb passive draw on the final movement/jump beat', () => {
  const characters = [
    {
      userId: 'alpha',
      username: 'alpha',
      position: { q: 5, r: 0 },
      facing: 180,
      characterId: 'murelious',
      characterName: 'Alpha',
    },
  ];

  const beats = [
    [buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing)],
    [buildEntry('alpha', 'm', 20, characters[0].position, characters[0].facing)],
    [buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing)],
    [buildEntry('alpha', 'E', 20, characters[0].position, characters[0].facing)],
  ];
  beats.forEach((beat) => {
    beat[0].cardId = 'step';
    beat[0].passiveCardId = 'absorb';
  });

  const result = executeBeats(beats, characters);
  const draws = (result.interactions || []).filter(
    (interaction) => interaction.type === 'draw' && interaction.actorUserId === 'alpha',
  );

  assert.equal(draws.length, 1);
  assert.equal(draws[0].drawCount, 1);
  assert.equal(draws[0].beatIndex, 1);
});

test('executeBeats applies fire hex damage from board tokens even when the token owner matches the target', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
  ];

  const beats = [[buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing)]];
  const tokens = [
    { id: 'fire:0', type: 'fire-hex', position: { q: 0, r: 0 }, facing: 0, ownerUserId: 'alpha' },
  ];

  const result = executeBeats(beats, characters, undefined, tokens);
  const beat0 = result.beats[0] || [];
  const alphaEntry = beat0.find((entry) => entry.username === 'alpha');

  assert.ok(alphaEntry);
  assert.equal(alphaEntry.damage, 1);
});

test('executeBeats places burning strike fire hexes on bracketed attacks', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
  ];

  const beats = [[buildEntry('alpha', '[a]', 20, characters[0].position, characters[0].facing, '', 0, 0)]];
  beats[0][0].cardId = 'burning-strike';
  beats[0][0].passiveCardId = 'step';

  const result = executeBeats(beats, characters);
  const tokens = result.boardTokens || [];

  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].type, 'fire-hex');
  assert.deepEqual(tokens[0].position, { q: 1, r: 0 });
});

test('executeBeats does not damage the mover from same-beat burning strike passive fire', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [[
    buildEntry('alpha', 'Bm-m', 20, characters[0].position, characters[0].facing, '', 0, 0),
    buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
  ]];
  beats[0][0].cardId = 'step';
  beats[0][0].passiveCardId = 'burning-strike';

  const firstResult = executeBeats(beats, characters);
  const firstBeat0 = firstResult.beats[0] || [];
  const firstAlphaEntry = firstBeat0.find((entry) => entry.username === 'alpha');
  const secondResult = executeBeats(beats, characters, undefined, firstResult.boardTokens || []);
  const secondBeat0 = secondResult.beats[0] || [];
  const secondAlphaEntry = secondBeat0.find((entry) => entry.username === 'alpha');

  assert.ok(firstAlphaEntry);
  assert.ok(secondAlphaEntry);
  assert.equal(firstAlphaEntry.damage, 0);
  assert.equal(secondAlphaEntry.damage, 0);
  assert.deepEqual(firstAlphaEntry.location, { q: 0, r: 0 });
  assert.deepEqual(secondAlphaEntry.location, { q: 0, r: 0 });
});

test('executeBeats delays burning strike passive fire until the next beat after successful movement', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 3, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'm', 20, characters[0].position, characters[0].facing, '', 0, 0),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];
  beats[0][0].cardId = 'step';
  beats[0][0].passiveCardId = 'burning-strike';

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const beat1 = result.beats[1] || [];
  const alphaBeat0 = beat0.find((entry) => entry.username === 'alpha');
  const alphaBeat1 = beat1.find((entry) => entry.username === 'alpha');
  const originFire = (result.boardTokens || []).find(
    (token) => token.type === 'fire-hex' && token.position.q === 0 && token.position.r === 0,
  );

  assert.ok(alphaBeat0);
  assert.ok(alphaBeat1);
  assert.equal(alphaBeat0.damage, 0);
  assert.equal(alphaBeat1.damage, 0);
  assert.deepEqual(alphaBeat0.location, { q: 1, r: 0 });
  assert.ok(originFire);
});

test('executeBeats delays burning strike passive fire for multi-m actions and keeps the mover undamaged', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 3, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'm-m', 20, characters[0].position, characters[0].facing, '', 0, 0),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];
  beats[0][0].cardId = 'step';
  beats[0][0].passiveCardId = 'burning-strike';

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const beat1 = result.beats[1] || [];
  const alphaBeat0 = beat0.find((entry) => entry.username === 'alpha');
  const alphaBeat1 = beat1.find((entry) => entry.username === 'alpha');
  const originFireCount = (result.boardTokens || []).filter(
    (token) => token.type === 'fire-hex' && token.position.q === 0 && token.position.r === 0,
  ).length;

  assert.ok(alphaBeat0);
  assert.ok(alphaBeat1);
  assert.equal(alphaBeat0.damage, 0);
  assert.equal(alphaBeat1.damage, 0);
  assert.deepEqual(alphaBeat0.location, { q: 1, r: 0 });
  assert.equal(originFireCount, 1);
});

test('executeBeats creates jab draw interactions on bracketed attacks', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
  ];

  const beats = [[buildEntry('alpha', '[a]', 20, characters[0].position, characters[0].facing, '', 1, 0)]];
  beats[0][0].cardId = 'jab';
  beats[0][0].passiveCardId = 'step';

  const result = executeBeats(beats, characters);
  const draw = (result.interactions || []).find((interaction) => interaction.type === 'draw');

  assert.ok(draw);
  assert.equal(draw.actorUserId, 'alpha');
  assert.equal(draw.drawCount, 1);
});

test('executeBeatsWithInteractions preserves Trip discard after Iron Will hand trigger resolves', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', '[a]', 65, characters[0].position, characters[0].facing, '', 2, 0),
      buildEntry('beta', 'W', 10, characters[1].position, characters[1].facing),
    ],
  ];
  beats[0][0].cardId = 'trip';
  beats[0][0].passiveCardId = 'step';

  const handTriggerAvailability = new Map([['beta', new Set(['iron-will'])]]);
  const firstPass = executeBeatsWithInteractions(
    beats,
    characters,
    [],
    undefined,
    undefined,
    [],
    handTriggerAvailability,
  );

  const ironWillPrompt = (firstPass.interactions || []).find(
    (interaction) =>
      interaction.type === 'hand-trigger' &&
      interaction.cardId === 'iron-will' &&
      interaction.actorUserId === 'beta' &&
      interaction.status === 'pending',
  );
  const firstPassDiscard = (firstPass.interactions || []).find((interaction) => interaction.type === 'discard');
  assert.ok(ironWillPrompt);
  assert.equal(firstPassDiscard, undefined);

  const resolvedInteractions = (firstPass.interactions || []).map((interaction) => {
    if (interaction.id !== ironWillPrompt.id) return interaction;
    return {
      ...interaction,
      status: 'resolved',
      resolution: { use: false },
    };
  });
  const secondPass = executeBeatsWithInteractions(
    firstPass.beats,
    characters,
    resolvedInteractions,
    undefined,
    undefined,
    [],
    handTriggerAvailability,
  );

  const discard = (secondPass.interactions || []).find(
    (interaction) =>
      interaction.type === 'discard' &&
      interaction.actorUserId === 'beta' &&
      interaction.beatIndex === 0,
  );

  assert.ok(discard);
  assert.equal(discard.discardCount, 2);
  assert.equal(discard.status, 'pending');
});

test('executeBeatsWithInteractions recreates missing Iron Will draw on resolved X1 beats', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 2, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      {
        ...buildEntry('alpha', 'X1', 18, characters[0].position, characters[0].facing),
        cardId: 'iron-will',
        passiveCardId: 'jump',
        calculated: true,
      },
      {
        ...buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
        calculated: true,
      },
    ],
  ];

  const result = executeBeatsWithInteractions(beats, characters, []);
  const draw = (result.interactions || []).find(
    (interaction) =>
      interaction.type === 'draw' &&
      interaction.actorUserId === 'alpha' &&
      interaction.beatIndex === 0,
  );

  assert.ok(draw);
  assert.equal(draw.drawCount, 3);
});

test('executeBeats blocks throws against hip-throw and tackle passives', () => {
  const passiveCards = ['hip-throw', 'tackle'];

  passiveCards.forEach((passiveCardId) => {
    const characters = [
      { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
      { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
    ];

    const beats = [
      [
        buildEntry('alpha', '[a]', 20, characters[0].position, characters[0].facing, '', 2, 0),
        buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
      ],
    ];

    beats[0][0].interaction = { type: 'throw' };
    beats[0][1].passiveCardId = passiveCardId;

    const result = executeBeats(beats, characters);
    const betaEntry = (result.beats[0] || []).find((entry) => entry.username === 'beta');

    assert.equal(result.interactions.some((interaction) => interaction.type === 'throw'), false);
    assert.ok(betaEntry);
    assert.equal(betaEntry.damage, 0);
    assert.equal(betaEntry.location.q, 1);
    assert.equal(betaEntry.location.r, 0);
  });
});

test('executeBeats still creates tackle throw interaction when thrower is hit with KBF 0', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', '[a]', 10, characters[0].position, characters[0].facing, '', 2, 0),
      buildEntry('beta', 'a', 20, characters[1].position, characters[1].facing, '', 2, 0),
    ],
  ];

  beats[0][0].cardId = 'tackle';
  beats[0][0].interaction = { type: 'throw' };

  const result = executeBeats(beats, characters);
  const throwInteraction = (result.interactions || []).find(
    (interaction) => interaction.type === 'throw' && interaction.actorUserId === 'alpha' && interaction.targetUserId === 'beta',
  );

  assert.ok(throwInteraction);
  assert.equal(throwInteraction.status, 'pending');
});

test('executeBeats reduces KBF by 1 for iron will passive hits', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'a', 20, characters[0].position, characters[0].facing, '', 1, 1),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];
  beats[0][1].passiveCardId = 'iron-will';

  const result = executeBeats(beats, characters);
  const betaEntry = (result.beats[0] || []).find((entry) => entry.username === 'beta');

  assert.ok(betaEntry);
  assert.equal(betaEntry.damage, 1);
  assert.equal(betaEntry.location.q, 1);
  assert.equal(betaEntry.location.r, 0);
});

test('executeBeats swaps reflex dodge on incoming W-hit and ends the set on a successful avoid', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'a', 80, characters[0].position, characters[0].facing, '', 2, 1),
      buildEntry('beta', 'W', 10, characters[1].position, characters[1].facing, '0', 0, 0),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  beats[0][1].cardId = 'dash';
  beats[0][1].passiveCardId = 'reflex-dodge';
  beats[0][1].rotationSource = 'selected';

  const result = executeBeats(beats, characters);
  const betaBeat0 = (result.beats[0] || []).find((entry) => entry.username === 'beta');
  const betaBeat1 = (result.beats[1] || []).find((entry) => entry.username === 'beta');
  const betaBeat2 = (result.beats[2] || []).find((entry) => entry.username === 'beta');
  const betaCharacter = result.characters.find((entry) => entry.userId === 'beta');

  assert.ok(betaBeat0);
  assert.ok(betaBeat1);
  assert.equal(betaBeat0.action, 'b-Lb-Rb');
  assert.equal(betaBeat0.cardId, 'reflex-dodge');
  assert.equal(betaBeat0.passiveCardId, 'dash');
  assert.equal(betaBeat1.action, 'E');
  assert.equal(betaBeat2, undefined);
  assert.ok(betaCharacter);
  assert.equal(betaCharacter.damage ?? 0, 0);
});

test('executeBeats reruns a frame when reflex dodge swaps during a later backflip W', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'Bm', 30, characters[1].position, characters[1].facing, '0', 0, 0),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 30, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', '2a', 80, characters[0].position, characters[0].facing, '', 2, 1),
      buildEntry('beta', 'W', 30, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  beats[0][1].cardId = 'backflip';
  beats[0][1].passiveCardId = 'reflex-dodge';
  beats[0][1].rotationSource = 'selected';
  beats[1][1].cardId = 'backflip';
  beats[1][1].passiveCardId = 'reflex-dodge';
  beats[2][1].cardId = 'backflip';
  beats[2][1].passiveCardId = 'reflex-dodge';
  beats[3][1].cardId = 'backflip';
  beats[3][1].passiveCardId = 'reflex-dodge';
  beats[4][1].cardId = 'backflip';
  beats[4][1].passiveCardId = 'reflex-dodge';

  const result = executeBeats(beats, characters);
  const betaBeat2 = (result.beats[2] || []).find((entry) => entry.username === 'beta');
  const betaBeat3 = (result.beats[3] || []).find((entry) => entry.username === 'beta');
  const betaBeat4 = (result.beats[4] || []).find((entry) => entry.username === 'beta');
  const betaCharacter = result.characters.find((entry) => entry.userId === 'beta');

  assert.ok(betaBeat2);
  assert.ok(betaBeat3);
  assert.equal(betaBeat2.action, 'b-Lb-Rb');
  assert.equal(betaBeat2.cardId, 'reflex-dodge');
  assert.equal(betaBeat2.passiveCardId, 'backflip');
  assert.equal(betaBeat2.location.q, 2);
  assert.equal(betaBeat2.location.r, 0);
  assert.equal(betaBeat3.action, 'E');
  assert.equal(betaBeat4, undefined);
  assert.ok(betaCharacter);
  assert.equal(betaCharacter.damage ?? 0, 0);
});

test('executeBeats reflex dodge swap does not reapply prior selected rotation on later W hits', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 30, characters[1].position, characters[1].facing, 'R1', 0, 0),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 30, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'a', 80, characters[0].position, characters[0].facing, '', 2, 1),
      buildEntry('beta', 'W', 30, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  beats[0][1].cardId = 'step';
  beats[0][1].passiveCardId = 'reflex-dodge';
  beats[0][1].rotationSource = 'selected';
  beats[1][1].cardId = 'step';
  beats[1][1].passiveCardId = 'reflex-dodge';
  beats[2][1].cardId = 'step';
  beats[2][1].passiveCardId = 'reflex-dodge';
  beats[3][1].cardId = 'step';
  beats[3][1].passiveCardId = 'reflex-dodge';
  beats[4][1].cardId = 'step';
  beats[4][1].passiveCardId = 'reflex-dodge';

  const result = executeBeats(beats, characters);
  const betaBeat2 = (result.beats[2] || []).find((entry) => entry.username === 'beta');
  const betaBeat3 = (result.beats[3] || []).find((entry) => entry.username === 'beta');
  const betaBeat4 = (result.beats[4] || []).find((entry) => entry.username === 'beta');
  const betaCharacter = result.characters.find((entry) => entry.userId === 'beta');

  assert.ok(betaBeat2);
  assert.ok(betaBeat3);
  assert.equal(betaBeat2.action, 'b-Lb-Rb');
  assert.equal(betaBeat2.cardId, 'reflex-dodge');
  assert.equal(betaBeat2.passiveCardId, 'step');
  assert.equal(betaBeat2.rotation ?? '', '');
  assert.equal(betaBeat3.action, 'E');
  assert.equal(betaBeat4, undefined);
  assert.ok(betaCharacter);
  assert.equal(betaCharacter.damage ?? 0, 0);
});

test('executeBeats leaves the reflex dodge X1->E beat unresolved after rerun', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'a', 80, characters[0].position, characters[0].facing, '', 2, 1),
      buildEntry('beta', 'b-Lb-Rb', 97, characters[1].position, characters[1].facing, '', 0, 0),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'X1', 97, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  beats[0][1].cardId = 'reflex-dodge';
  beats[0][1].passiveCardId = 'step';
  beats[1][1].cardId = 'reflex-dodge';
  beats[1][1].passiveCardId = 'step';
  beats[2][1].cardId = 'reflex-dodge';
  beats[2][1].passiveCardId = 'step';

  const result = executeBeats(beats, characters);
  const betaBeat1 = (result.beats[1] || []).find((entry) => entry.username === 'beta');
  const betaBeat2 = (result.beats[2] || []).find((entry) => entry.username === 'beta');

  assert.ok(betaBeat1);
  assert.equal(betaBeat1.action, 'E');
  assert.equal(betaBeat1.calculated, false);
  assert.equal(betaBeat2, undefined);
  assert.equal(result.lastCalculated, 0);
});

test('executeBeats applies smoke-bomb stun as grey hit frames without knockback movement', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'W', 87, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 10, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', '[a-La-Ra]', 87, characters[0].position, characters[0].facing, '', 0, 0),
      buildEntry('beta', 'm', 10, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 10, characters[0].position, characters[0].facing, 'R2'),
      buildEntry('beta', 'm', 10, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'Bm', 10, characters[0].position, characters[0].facing),
      buildEntry('beta', 'm', 10, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 10, characters[0].position, characters[0].facing),
      buildEntry('beta', 'm', 10, characters[1].position, characters[1].facing),
    ],
  ];

  beats[0][0].cardId = 'smoke-bomb';
  beats[0][0].passiveCardId = 'step';
  beats[1][0].cardId = 'smoke-bomb';
  beats[1][0].passiveCardId = 'step';
  beats[2][0].cardId = 'step';
  beats[2][0].passiveCardId = 'smoke-bomb';
  beats[2][0].rotationSource = 'selected';
  beats[3][0].cardId = 'step';
  beats[3][0].passiveCardId = 'smoke-bomb';

  const result = executeBeats(beats, characters);
  const betaBeat1 = (result.beats[1] || []).find((entry) => entry.username === 'beta');
  const betaBeat2 = (result.beats[2] || []).find((entry) => entry.username === 'beta');
  const betaBeat3 = (result.beats[3] || []).find((entry) => entry.username === 'beta');
  const betaBeat4 = (result.beats[4] || []).find((entry) => entry.username === 'beta');
  const betaCharacter = result.characters.find((entry) => entry.userId === 'beta');

  assert.ok(betaBeat1);
  assert.ok(betaBeat2);
  assert.ok(betaBeat3);
  assert.equal(betaBeat1.action, 'DamageIcon');
  assert.equal(betaBeat1.stunOnly, true);
  assert.equal(betaBeat1.location.q, 1);
  assert.equal(betaBeat1.location.r, 0);
  assert.equal(betaBeat2.action, 'DamageIcon');
  assert.equal(betaBeat2.stunOnly, true);
  assert.equal(betaBeat2.location.q, 1);
  assert.equal(betaBeat2.location.r, 0);
  assert.equal(betaBeat3.action, 'DamageIcon');
  assert.equal(betaBeat3.stunOnly, true);
  assert.equal(betaBeat4.action, 'E');
  assert.equal(betaBeat4.stunOnly, undefined);
  assert.ok(betaCharacter);
  assert.equal(betaCharacter.damage ?? 0, 0);
});

test('executeBeats applies smoke-bomb stun even when the attack entry is tagged as throw', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', '[a-La-Ra]', 87, characters[0].position, characters[0].facing, '', 0, 0),
      buildEntry('beta', 'm', 10, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 10, characters[0].position, characters[0].facing),
      buildEntry('beta', 'm', 10, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 10, characters[0].position, characters[0].facing),
      buildEntry('beta', 'm', 10, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 10, characters[0].position, characters[0].facing),
      buildEntry('beta', 'm', 10, characters[1].position, characters[1].facing),
    ],
  ];

  beats[0][0].cardId = 'smoke-bomb';
  beats[0][0].passiveCardId = 'leap';
  beats[0][0].interaction = { type: 'throw' };
  beats[0][0].rotation = '0';
  beats[0][0].rotationSource = 'selected';

  const result = executeBeats(beats, characters);
  const betaBeat0 = (result.beats[0] || []).find((entry) => entry.username === 'beta');
  const betaBeat1 = (result.beats[1] || []).find((entry) => entry.username === 'beta');
  const betaBeat2 = (result.beats[2] || []).find((entry) => entry.username === 'beta');
  const betaBeat3 = (result.beats[3] || []).find((entry) => entry.username === 'beta');
  const betaBeat4 = (result.beats[4] || []).find((entry) => entry.username === 'beta');
  const betaBeat5 = (result.beats[5] || []).find((entry) => entry.username === 'beta');

  assert.ok(betaBeat0);
  assert.ok(betaBeat1);
  assert.ok(betaBeat2);
  assert.ok(betaBeat3);
  assert.ok(betaBeat4);
  assert.ok(betaBeat5);
  assert.equal(betaBeat0.action, 'DamageIcon');
  assert.equal(betaBeat0.stunOnly, true);
  assert.equal(betaBeat1.action, 'DamageIcon');
  assert.equal(betaBeat1.stunOnly, true);
  assert.equal(betaBeat2.action, 'DamageIcon');
  assert.equal(betaBeat2.stunOnly, true);
  assert.equal(betaBeat3.action, 'DamageIcon');
  assert.equal(betaBeat3.stunOnly, true);
  assert.equal(betaBeat4.action, 'DamageIcon');
  assert.equal(betaBeat4.stunOnly, true);
  assert.equal(betaBeat5.action, 'E');
  assert.equal(result.interactions.some((interaction) => interaction.type === 'throw'), false);
});

test('executeBeats applies smoke-bomb right-arc stun from bracketed a-La-Ra actions', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: -1 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [[
    buildEntry('alpha', '[a-La-Ra]', 87, characters[0].position, characters[0].facing, '', 0, 0),
    buildEntry('beta', 'W', 10, characters[1].position, characters[1].facing),
  ]];

  beats[0][0].cardId = 'smoke-bomb';
  beats[0][0].passiveCardId = 'backflip';
  beats[0][0].rotation = '0';
  beats[0][0].rotationSource = 'selected';

  const result = executeBeats(beats, characters);
  const betaBeat0 = (result.beats[0] || []).find((entry) => entry.username === 'beta');

  assert.ok(betaBeat0);
  assert.equal(betaBeat0.action, 'DamageIcon');
  assert.equal(betaBeat0.stunOnly, true);
});

test('executeBeats treats smoke-bomb bracketed attacks as unblockable', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [[
    buildEntry('alpha', '[a-La-Ra]', 87, characters[0].position, characters[0].facing, '0', 0, 0),
    buildEntry('beta', '[b]', 99, characters[1].position, characters[1].facing),
  ]];

  beats[0][0].cardId = 'smoke-bomb';
  beats[0][0].passiveCardId = 'step';
  beats[0][0].rotationSource = 'selected';
  beats[0][1].cardId = 'parry';
  beats[0][1].passiveCardId = 'step';

  const result = executeBeats(beats, characters);
  const betaBeat0 = (result.beats[0] || []).find((entry) => entry.username === 'beta');
  const betaBeat1 = (result.beats[1] || []).find((entry) => entry.username === 'beta');

  assert.ok(betaBeat0);
  assert.ok(betaBeat1);
  assert.equal(betaBeat0.action, '[b]');
  assert.equal(betaBeat1.action, 'DamageIcon');
  assert.equal(betaBeat1.stunOnly, true);
});

test('executeBeats preserves character baseline state in returned characters', () => {
  const characters = [
    {
      userId: 'alpha',
      username: 'alpha',
      position: { q: 0, r: 0 },
      facing: 120,
      damage: 7,
      characterId: 'murelious',
      characterName: 'Alpha',
    },
    {
      userId: 'beta',
      username: 'beta',
      position: { q: 2, r: -1 },
      facing: 240,
      damage: 3,
      characterId: 'zenytha',
      characterName: 'Beta',
    },
  ];

  const beats = [
    [
      buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'E', 0, characters[1].position, characters[1].facing),
    ],
  ];

  const result = executeBeats(beats, characters);
  const alpha = result.characters.find((character) => character.userId === 'alpha');
  const beta = result.characters.find((character) => character.userId === 'beta');

  assert.ok(alpha);
  assert.ok(beta);
  assert.deepEqual(alpha.position, characters[0].position);
  assert.equal(alpha.damage, characters[0].damage);
  assert.equal(alpha.facing, characters[0].facing);
  assert.deepEqual(beta.position, characters[1].position);
  assert.equal(beta.damage, characters[1].damage);
  assert.equal(beta.facing, characters[1].facing);
});

test('executeBeats converts Gigantic Staff movement to 2j when on abyss', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 2, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];
  const beats = [
    [
      buildEntry('alpha', 'm', 10, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];
  beats[0][0].passiveCardId = 'gigantic-staff';

  const land = [{ q: 99, r: 99 }];
  const result = executeBeats(beats, characters, land);
  const alphaEntry = (result.beats[0] || []).find((entry) => entry.username === 'alpha');

  assert.ok(alphaEntry);
  assert.equal(alphaEntry.action, '2j');
});

test('executeBeats applies cross-slash passive self damage at action start', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'm', 20, characters[0].position, characters[0].facing),
    ],
  ];

  beats[0][0].passiveCardId = 'cross-slash';
  beats[0][0].rotationSource = 'selected';

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const alphaEntry = beat0.find((entry) => entry.username === 'alpha');

  assert.ok(alphaEntry);
  assert.equal(alphaEntry.damage, 1);
  assert.ok(alphaEntry.consequences?.some((effect) => effect.type === 'hit' && effect.damageDelta === 1));
});

test('executeBeats records Healing Harmony self-heal as negative timeline consequence', () => {
  const characters = [
    {
      userId: 'alpha',
      username: 'alpha',
      position: { q: 0, r: 0 },
      facing: 180,
      damage: 5,
      characterId: 'murelious',
      characterName: 'Alpha',
    },
  ];

  const beats = [
    [
      buildEntry('alpha', 'X1', 20, characters[0].position, characters[0].facing),
    ],
  ];
  beats[0][0].cardId = 'healing-harmony';

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const alphaEntry = beat0.find((entry) => entry.username === 'alpha');
  const hitConsequences = (alphaEntry?.consequences ?? []).filter((effect) => effect?.type === 'hit');

  assert.ok(alphaEntry);
  assert.equal(alphaEntry.damage, 2);
  assert.equal(hitConsequences.length, 1);
  assert.deepEqual(hitConsequences[0], { type: 'hit', damageDelta: -3, knockbackDistance: 0 });
});

test('executeBeats resolves parry counters even when a defender is at E', () => {
  const characters = [
    { userId: 'def', username: 'def', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Def' },
    { userId: 'atk', username: 'atk', position: { q: 1, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Atk' },
  ];

  const beats = [
    [
      buildEntry('def', '[b]', 99, characters[0].position, characters[0].facing),
      buildEntry('atk', 'a', 10, characters[1].position, characters[1].facing, '', 2, 1),
    ],
    [
      buildEntry('def', 'E', 0, characters[0].position, characters[0].facing),
      buildEntry('atk', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  beats[0][0].cardId = 'parry';
  beats[0][0].passiveCardId = 'step';

  const result = executeBeats(beats, characters);
  const beat1 = result.beats[1] || [];
  const attackerEntry = beat1.find((entry) => entry.username === 'atk');
  const hitConsequences = (attackerEntry?.consequences ?? []).filter((effect) => effect?.type === 'hit');

  assert.ok(attackerEntry);
  assert.equal(attackerEntry.action, 'DamageIcon');
  assert.equal(hitConsequences.length, 1);
  assert.deepEqual(hitConsequences[0], { type: 'hit', damageDelta: 4, knockbackDistance: 1 });
});

test('parry stun does not trap future submissions on calculated history E beats', () => {
  const characters = [
    { userId: 'def', username: 'def', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Def' },
    { userId: 'atk', username: 'atk', position: { q: 1, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Atk' },
  ];

  const beats = [
    [
      buildEntry('def', '[b]', 99, characters[0].position, characters[0].facing),
      buildEntry('atk', 'a', 10, characters[1].position, characters[1].facing, '', 2, 1),
    ],
    [
      buildEntry('def', 'E', 0, characters[0].position, characters[0].facing),
      buildEntry('atk', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];
  beats[0][0].cardId = 'parry';
  beats[0][0].passiveCardId = 'step';

  const afterParry = executeBeats(beats, characters);
  const earliestIndex = getTimelineEarliestEIndex(afterParry.beats, characters);
  const atBat = getCharactersAtEarliestE(afterParry.beats, characters).map((character) => character.userId);

  assert.equal(earliestIndex, 2);
  assert.deepEqual(atBat, ['def']);

  const actionList = [
    {
      action: 'm',
      rotation: 'R1',
      rotationSource: 'selected',
      priority: 50,
      damage: 0,
      kbf: 0,
      cardId: 'step',
      passiveCardId: 'jab',
    },
  ];
  const withSubmission = applyActionSetToBeats(afterParry.beats, characters, 'def', actionList, []);
  const afterSubmission = executeBeats(withSubmission, characters);
  const beat2 = afterSubmission.beats[2] || [];
  const defenderEntry = beat2.find((entry) => entry.username === 'def');

  assert.ok(defenderEntry);
  assert.equal(defenderEntry.action, 'm');
});

test('executeBeats starts rewind focus on F without opening a return choice at that beat', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];
  const beats = [
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'F', 90, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];
  beats[1][0].cardId = 'rewind';

  const result = executeBeats(beats, characters);
  const focus = result.interactions.find(
    (interaction) => interaction.type === 'rewind-focus' && interaction.actorUserId === 'alpha',
  );
  const pendingReturn = result.interactions.find(
    (interaction) =>
      interaction.type === 'rewind-return' &&
      interaction.status === 'pending' &&
      interaction.actorUserId === 'alpha' &&
      interaction.beatIndex === 1,
  );
  const alphaBeat1 = (result.beats[1] || []).find((entry) => entry.username === 'alpha');
  const focusToken = result.boardTokens.find(
    (token) => token.type === 'focus-anchor' && token.ownerUserId === 'alpha',
  );

  assert.ok(focus);
  assert.equal(focus.status, 'resolved');
  assert.equal(focus.resolution?.active, true);
  assert.equal(pendingReturn, undefined);
  assert.ok(alphaBeat1);
  assert.equal(alphaBeat1.focusCardId, 'rewind');
  assert.ok(focusToken);
});

test('executeBeatsWithInteractions opens rewind return choice on focused E beats', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];
  const beats = [[
    buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing),
    buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
  ]];
  const interactions = [{
    id: 'rewind-focus:0:alpha:alpha',
    type: 'rewind-focus',
    beatIndex: 0,
    actorUserId: 'alpha',
    targetUserId: 'alpha',
    status: 'resolved',
    cardId: 'rewind',
    resolution: {
      active: true,
      cardId: 'rewind',
      anchorHex: { q: 0, r: 0 },
      focusStartBeatIndex: 0,
      returnActions: [
        { action: 'W', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
        { action: 'W', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
        { action: 'E', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
      ],
    },
  }];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const pendingReturn = result.interactions.find(
    (interaction) =>
      interaction.type === 'rewind-return' &&
      interaction.status === 'pending' &&
      interaction.actorUserId === 'alpha' &&
      interaction.beatIndex === 0,
  );

  assert.ok(pendingReturn);
});

test('executeBeatsWithInteractions opens rewind return choice on focused implicit-open beats', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];
  const beats = [[
    buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
    buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
  ]];
  const interactions = [{
    id: 'rewind-focus:0:alpha:alpha',
    type: 'rewind-focus',
    beatIndex: 0,
    actorUserId: 'alpha',
    targetUserId: 'alpha',
    status: 'resolved',
    cardId: 'rewind',
    resolution: {
      active: true,
      cardId: 'rewind',
      anchorHex: { q: 0, r: 0 },
      focusStartBeatIndex: 0,
      returnActions: [
        { action: 'W', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
        { action: 'W', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
        { action: 'E', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
      ],
    },
  }];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const pendingReturn = result.interactions.find(
    (interaction) =>
      interaction.type === 'rewind-return' &&
      interaction.status === 'pending' &&
      interaction.actorUserId === 'alpha' &&
      interaction.beatIndex === 1,
  );

  assert.ok(pendingReturn);
});

test('executeBeatsWithInteractions reopens rewind return when a stale declined interaction collides with a new focus', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];
  const beats = [[
    buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing),
    buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
  ]];
  const interactions = [
    {
      id: 'rewind-focus:0:alpha:alpha:old',
      type: 'rewind-focus',
      beatIndex: 0,
      actorUserId: 'alpha',
      targetUserId: 'alpha',
      status: 'resolved',
      cardId: 'rewind',
      resolution: {
        active: false,
        cardId: 'rewind',
        anchorHex: { q: 0, r: 0 },
        focusStartBeatIndex: 0,
        endedBeatIndex: 0,
        endReason: 'returned',
      },
    },
    {
      id: 'rewind-return:0:alpha:alpha',
      type: 'rewind-return',
      beatIndex: 0,
      actorUserId: 'alpha',
      targetUserId: 'alpha',
      status: 'resolved',
      cardId: 'rewind',
      resolution: {
        focusInteractionId: 'rewind-focus:0:alpha:alpha:old',
        anchorHex: { q: 0, r: 0 },
        returnToAnchor: false,
      },
    },
    {
      id: 'rewind-focus:0:alpha:alpha:new',
      type: 'rewind-focus',
      beatIndex: 0,
      actorUserId: 'alpha',
      targetUserId: 'alpha',
      status: 'resolved',
      cardId: 'rewind',
      resolution: {
        active: true,
        cardId: 'rewind',
        anchorHex: { q: 0, r: 0 },
        focusStartBeatIndex: 0,
        returnActions: [
          { action: 'W', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
          { action: 'W', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
          { action: 'E', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
        ],
      },
    },
  ];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const rewindReturn = result.interactions.find((interaction) => interaction.id === 'rewind-return:0:alpha:alpha');

  assert.ok(rewindReturn);
  assert.equal(rewindReturn.status, 'pending');
  assert.equal(rewindReturn.resolution?.focusInteractionId, 'rewind-focus:0:alpha:alpha:new');
});

test('executeBeatsWithInteractions preserves submitted start after rewind return when history already has DamageIcon rewrites', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: -1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];
  const beats = [
    [
      buildEntry('alpha', 'W', 90, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 10, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 90, characters[0].position, characters[0].facing),
      buildEntry('beta', 'a', 67, characters[1].position, characters[1].facing, '', 3, 2),
    ],
    [
      buildEntry('alpha', 'DamageIcon', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 67, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'DamageIcon', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 67, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'B2m', 20, characters[0].position, characters[0].facing, 'L2'),
      buildEntry('beta', 'E', 0, characters[1].position, characters[1].facing),
    ],
  ];
  beats[0][0].cardId = 'rewind';
  beats[1][0].cardId = 'rewind';
  beats[2][0].cardId = 'rewind';
  beats[4][0].cardId = 'dash';
  beats[4][0].passiveCardId = 'push-kick';
  beats[4][0].rotationSource = 'selected';
  beats[4][0].play = [{ type: 'action-set', activeCardId: 'dash', passiveCardId: 'push-kick', rotation: 'L2' }];
  for (let i = 0; i <= 3; i += 1) {
    beats[i][0].calculated = true;
    beats[i][1].calculated = true;
  }

  const interactions = [{
    id: 'rewind-return:0:alpha:alpha',
    type: 'rewind-return',
    beatIndex: 0,
    actorUserId: 'alpha',
    targetUserId: 'alpha',
    status: 'resolved',
    cardId: 'rewind',
    resolution: {
      returnToAnchor: true,
      applied: true,
      focusInteractionId: 'rewind-focus:0:alpha:alpha',
      anchorHex: { q: 0, r: 0 },
      returnActions: [
        { action: 'W', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
        { action: 'W', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
        { action: 'E', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
      ],
    },
  }];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const alphaBeat4 = (result.beats[4] || []).find((entry) => entry.username === 'alpha');

  assert.ok(alphaBeat4);
  assert.equal(alphaBeat4.action, 'B2m');
  assert.equal(alphaBeat4.rotationSource, 'selected');
});

test('executeBeats keeps clamped damage icons when the next beat is a protected selected start', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: -1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];
  const beats = [
    [
      buildEntry('alpha', 'W', 90, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 10, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 90, characters[0].position, characters[0].facing),
      buildEntry('beta', 'a', 67, characters[1].position, characters[1].facing, '', 3, 2),
    ],
    [
      buildEntry('alpha', 'DamageIcon', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 67, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'B2m', 20, characters[0].position, characters[0].facing, 'L2'),
      buildEntry('beta', 'W', 67, characters[1].position, characters[1].facing),
    ],
  ];
  beats[3][0].cardId = 'dash';
  beats[3][0].passiveCardId = 'push-kick';
  beats[3][0].rotationSource = 'selected';

  const result = executeBeats(beats, characters);
  const alphaBeat2 = (result.beats[2] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat3 = (result.beats[3] || []).find((entry) => entry.username === 'alpha');

  assert.ok(alphaBeat2);
  assert.ok(alphaBeat3);
  assert.equal(alphaBeat2.action, 'DamageIcon');
  assert.equal(alphaBeat3.action, 'B2m');
  assert.equal(alphaBeat3.rotationSource, 'selected');
});

test('executeBeatsWithInteractions applies resolved rewind return and runs rewind trailing actions', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];
  const beats = [[
    buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing),
    buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
  ]];
  const interactions = [
    {
      id: 'rewind-focus:0:alpha:alpha',
      type: 'rewind-focus',
      beatIndex: 0,
      actorUserId: 'alpha',
      targetUserId: 'alpha',
      status: 'resolved',
      cardId: 'rewind',
      resolution: {
        active: true,
        cardId: 'rewind',
        anchorHex: { q: 0, r: 0 },
        focusStartBeatIndex: 0,
        returnActions: [
          { action: 'W', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
          { action: 'W', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
          { action: 'E', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
        ],
      },
    },
    {
      id: 'rewind-return:0:alpha:alpha',
      type: 'rewind-return',
      beatIndex: 0,
      actorUserId: 'alpha',
      targetUserId: 'alpha',
      status: 'resolved',
      cardId: 'rewind',
      resolution: {
        returnToAnchor: true,
        focusInteractionId: 'rewind-focus:0:alpha:alpha',
        anchorHex: { q: 0, r: 0 },
      },
    },
  ];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const alphaBeat0 = (result.beats[0] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat1 = (result.beats[1] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat2 = (result.beats[2] || []).find((entry) => entry.username === 'alpha');
  const updatedFocus = result.interactions.find((interaction) => interaction.id === 'rewind-focus:0:alpha:alpha');
  const updatedReturn = result.interactions.find((interaction) => interaction.id === 'rewind-return:0:alpha:alpha');

  assert.ok(alphaBeat0);
  assert.ok(alphaBeat1);
  assert.ok(alphaBeat2);
  assert.equal(alphaBeat0.action, 'W');
  assert.equal(alphaBeat1.action, 'W');
  assert.equal(alphaBeat2.action, 'E');
  assert.equal(updatedFocus?.resolution?.active, false);
  assert.equal(updatedFocus?.resolution?.endReason, 'returned');
  assert.equal(updatedReturn?.resolution?.applied, true);
});

test('executeBeatsWithInteractions stuns rewind return actor when the anchor hex is occupied', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];
  const beats = [[
    buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing),
    buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
  ]];
  const interactions = [
    {
      id: 'rewind-focus:0:alpha:alpha',
      type: 'rewind-focus',
      beatIndex: 0,
      actorUserId: 'alpha',
      targetUserId: 'alpha',
      status: 'resolved',
      cardId: 'rewind',
      resolution: {
        active: true,
        cardId: 'rewind',
        anchorHex: { q: 0, r: 0 },
        focusStartBeatIndex: 0,
        returnActions: [
          { action: 'W', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
          { action: 'W', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
          { action: 'E', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
        ],
      },
    },
    {
      id: 'rewind-return:0:alpha:alpha',
      type: 'rewind-return',
      beatIndex: 0,
      actorUserId: 'alpha',
      targetUserId: 'alpha',
      status: 'resolved',
      cardId: 'rewind',
      resolution: {
        returnToAnchor: true,
        focusInteractionId: 'rewind-focus:0:alpha:alpha',
        anchorHex: { q: 0, r: 0 },
      },
    },
  ];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const alphaBeat0 = (result.beats[0] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat1 = (result.beats[1] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat2 = (result.beats[2] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat3 = (result.beats[3] || []).find((entry) => entry.username === 'alpha');
  const betaBeat0 = (result.beats[0] || []).find((entry) => entry.username === 'beta');
  const updatedFocus = result.interactions.find((interaction) => interaction.id === 'rewind-focus:0:alpha:alpha');
  const updatedReturn = result.interactions.find((interaction) => interaction.id === 'rewind-return:0:alpha:alpha');

  assert.ok(alphaBeat0);
  assert.ok(alphaBeat1);
  assert.ok(alphaBeat2);
  assert.ok(alphaBeat3);
  assert.ok(betaBeat0);
  assert.equal(alphaBeat0.action, 'DamageIcon');
  assert.equal(alphaBeat1.action, 'DamageIcon');
  assert.equal(alphaBeat2.action, 'DamageIcon');
  assert.equal(alphaBeat3.action, 'E');
  assert.equal(alphaBeat0.stunOnly, true);
  assert.equal(alphaBeat1.stunOnly, true);
  assert.equal(alphaBeat2.stunOnly, true);
  assert.equal(alphaBeat3.stunOnly, undefined);
  assert.deepEqual(alphaBeat0.location, { q: 1, r: 0 });
  assert.deepEqual(betaBeat0.location, { q: 0, r: 0 });
  assert.equal(updatedFocus?.resolution?.active, false);
  assert.equal(updatedFocus?.resolution?.endReason, 'returned');
  assert.equal(updatedReturn?.resolution?.applied, true);
  assert.equal(updatedReturn?.resolution?.blockedByOccupant, true);
  assert.equal(updatedReturn?.resolution?.blockedOccupantUserId, 'beta');
  assert.equal(updatedReturn?.resolution?.stunDuration, 3);
});

test('executeBeatsWithInteractions keeps resolved rewind return teleport without overwriting later actions', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 2, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];
  const beats = [
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'm', 50, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];
  beats[0][0].cardId = 'rewind';
  beats[1][0].cardId = 'rewind';
  beats[2][0].cardId = 'step';
  const interactions = [{
    id: 'rewind-return:0:alpha:alpha',
    type: 'rewind-return',
    beatIndex: 0,
    actorUserId: 'alpha',
    targetUserId: 'alpha',
    status: 'resolved',
    cardId: 'rewind',
    resolution: {
      returnToAnchor: true,
      applied: true,
      anchorHex: { q: 0, r: 0 },
    },
  }];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const alphaBeat0 = (result.beats[0] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat2 = (result.beats[2] || []).find((entry) => entry.username === 'alpha');
  const updatedReturn = result.interactions.find((interaction) => interaction.id === 'rewind-return:0:alpha:alpha');

  assert.ok(alphaBeat0);
  assert.ok(alphaBeat2);
  assert.equal(alphaBeat0.action, 'W');
  assert.equal(alphaBeat2.action, 'm');
  assert.deepEqual(alphaBeat0.location, { q: 0, r: 0 });
  assert.deepEqual(alphaBeat2.location, { q: 0, r: 0 });
  assert.equal(updatedReturn?.resolution?.applied, true);
});

test('executeBeatsWithInteractions rehydrates applied rewind return window without clearing later beats', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 2, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];
  const beats = [
    [
      buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'm', 50, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];
  beats[3][0].cardId = 'step';
  const interactions = [{
    id: 'rewind-return:0:alpha:alpha',
    type: 'rewind-return',
    beatIndex: 0,
    actorUserId: 'alpha',
    targetUserId: 'alpha',
    status: 'resolved',
    cardId: 'rewind',
    resolution: {
      returnToAnchor: true,
      applied: true,
      anchorHex: { q: 0, r: 0 },
    },
  }];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const alphaBeat0 = (result.beats[0] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat1 = (result.beats[1] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat2 = (result.beats[2] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat3 = (result.beats[3] || []).find((entry) => entry.username === 'alpha');
  const updatedReturn = result.interactions.find((interaction) => interaction.id === 'rewind-return:0:alpha:alpha');

  assert.ok(alphaBeat0);
  assert.ok(alphaBeat1);
  assert.ok(alphaBeat2);
  assert.ok(alphaBeat3);
  assert.equal(alphaBeat0.action, 'W');
  assert.equal(alphaBeat1.action, 'W');
  assert.equal(alphaBeat2.action, 'E');
  assert.equal(alphaBeat3.action, 'm');
  assert.deepEqual(alphaBeat0.location, { q: 0, r: 0 });
  assert.deepEqual(alphaBeat3.location, { q: 0, r: 0 });
  assert.equal(updatedReturn?.resolution?.applied, true);
  assert.ok(Array.isArray(updatedReturn?.resolution?.returnActions));
});

test('parry cleanup preserves committed rewind return windows before later action-set starts', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 0, characterId: 'murelious', characterName: 'Beta' },
  ];
  const beats = [
    [
      buildEntry('alpha', '[b]', 99, characters[0].position, characters[0].facing),
      buildEntry('beta', 'a', 10, characters[1].position, characters[1].facing, '', 2, 1),
    ],
    [
      buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 90, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'W', 90, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'm', 32, characters[0].position, characters[0].facing, 'R1'),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];
  beats[0][0].cardId = 'parry';
  beats[0][0].passiveCardId = 'step';
  beats[2][0].cardId = 'rewind';
  beats[3][0].cardId = 'rewind';
  beats[4][0].cardId = 'step';
  beats[4][0].passiveCardId = 'jab';
  beats[4][0].rotationSource = 'selected';
  const interactions = [{
    id: 'rewind-return:2:alpha:alpha',
    type: 'rewind-return',
    beatIndex: 2,
    actorUserId: 'alpha',
    targetUserId: 'alpha',
    status: 'resolved',
    cardId: 'rewind',
    resolution: {
      returnToAnchor: true,
      applied: true,
      anchorHex: { q: 0, r: 0 },
      returnActions: [
        { action: 'W', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
        { action: 'W', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
        { action: 'E', rotation: '', priority: 90, damage: 0, kbf: 0, cardId: 'rewind' },
      ],
    },
  }];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const alphaBeat2 = (result.beats[2] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat3 = (result.beats[3] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat4 = (result.beats[4] || []).find((entry) => entry.username === 'alpha');

  assert.ok(alphaBeat2);
  assert.ok(alphaBeat3);
  assert.ok(alphaBeat4);
  assert.equal(alphaBeat2.action, 'W');
  assert.equal(alphaBeat3.action, 'W');
  assert.equal(alphaBeat4.action, 'm');
  assert.equal(alphaBeat4.rotationSource, 'selected');
});

test('executeBeatsWithInteractions rehydrates applied blocked rewind return stun without clearing later beats', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];
  const beats = [
    [
      buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'E', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
    [
      buildEntry('alpha', 'm', 50, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];
  beats[4][0].cardId = 'step';
  const interactions = [{
    id: 'rewind-return:0:alpha:alpha',
    type: 'rewind-return',
    beatIndex: 0,
    actorUserId: 'alpha',
    targetUserId: 'alpha',
    status: 'resolved',
    cardId: 'rewind',
    resolution: {
      returnToAnchor: true,
      applied: true,
      blockedByOccupant: true,
      blockedOccupantUserId: 'beta',
      stunDuration: 3,
      anchorHex: { q: 0, r: 0 },
    },
  }];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const alphaBeat0 = (result.beats[0] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat1 = (result.beats[1] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat2 = (result.beats[2] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat3 = (result.beats[3] || []).find((entry) => entry.username === 'alpha');
  const alphaBeat4 = (result.beats[4] || []).find((entry) => entry.username === 'alpha');
  const updatedReturn = result.interactions.find((interaction) => interaction.id === 'rewind-return:0:alpha:alpha');

  assert.ok(alphaBeat0);
  assert.ok(alphaBeat1);
  assert.ok(alphaBeat2);
  assert.ok(alphaBeat3);
  assert.ok(alphaBeat4);
  assert.equal(alphaBeat0.action, 'DamageIcon');
  assert.equal(alphaBeat1.action, 'DamageIcon');
  assert.equal(alphaBeat2.action, 'DamageIcon');
  assert.equal(alphaBeat3.action, 'E');
  assert.equal(alphaBeat4.action, 'm');
  assert.equal(alphaBeat0.stunOnly, true);
  assert.equal(alphaBeat1.stunOnly, true);
  assert.equal(alphaBeat2.stunOnly, true);
  assert.equal(alphaBeat3.stunOnly, undefined);
  assert.deepEqual(alphaBeat0.location, { q: 1, r: 0 });
  assert.equal(updatedReturn?.resolution?.applied, true);
  assert.equal(updatedReturn?.resolution?.blockedByOccupant, true);
  assert.equal(updatedReturn?.resolution?.stunDuration, 3);
});
