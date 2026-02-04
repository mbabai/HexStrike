const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executeBeats } = require('../dist/game/execute.js');

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
      buildEntry('alpha', '1a', 20, characters[0].position, characters[0].facing, '', 2, 0),
      buildEntry('beta', '1m', 0, characters[1].position, characters[1].facing, 'R1', 0, 0),
    ],
  ];

  const result = executeBeats(beats, characters);
  const beat0 = result.beats[0] || [];
  const betaEntry = beat0.find((entry) => entry.username === 'beta');

  assert.ok(betaEntry);
  assert.equal(betaEntry.location.q, 1);
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

test('executeBeats treats Grappling Hook as a throw only when starting on land', () => {
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

test('executeBeats clamps Grappling Hook charge to the first land tile ahead', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: -4, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
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
  assert.equal(alphaEntry.location.q, -2);
  assert.equal(alphaEntry.location.r, 0);
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

test('executeBeats applies fire hex damage from board tokens', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
  ];

  const beats = [[buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing)]];
  const tokens = [
    { id: 'fire:0', type: 'fire-hex', position: { q: 0, r: 0 }, facing: 0 },
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
