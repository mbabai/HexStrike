const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executeBeatsWithInteractions } = require('../dist/game/execute.js');

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

const findHitConsequence = (entry) => {
  const consequences = Array.isArray(entry?.consequences) ? entry.consequences : [];
  return consequences.find((item) => item?.type === 'hit') ?? null;
};

test('burning strike opens a hand-trigger interaction when in hand and attack hits', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'a', 20, characters[0].position, characters[0].facing, '', 4, 1),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  const handTriggerAvailability = new Map([['alpha', new Set(['burning-strike'])]]);
  const result = executeBeatsWithInteractions(
    beats,
    characters,
    [],
    undefined,
    new Map(),
    [],
    handTriggerAvailability,
  );
  const interaction = result.interactions.find(
    (item) => item?.type === 'hand-trigger' && item?.cardId === 'burning-strike',
  );

  assert.ok(interaction, 'Expected a burning strike hand-trigger interaction');
  assert.equal(interaction.status, 'pending');
  assert.ok(Array.isArray(interaction.attackHexes));
  assert.deepEqual(interaction.attackHexes[0], { q: 1, r: 0 });
});

test('iron will resolves with zero knockback when used', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 1, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'a', 20, characters[0].position, characters[0].facing, '', 4, 3),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  const interactions = [
    {
      id: 'hand-trigger:iron-will:0:beta:alpha',
      type: 'hand-trigger',
      beatIndex: 0,
      actorUserId: 'beta',
      targetUserId: 'beta',
      sourceUserId: 'alpha',
      status: 'resolved',
      cardId: 'iron-will',
      cardType: 'ability',
      resolution: { use: true },
    },
  ];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const beat0 = result.beats[0] || [];
  const betaEntry = beat0.find((entry) => entry.username === 'beta');
  const hit = findHitConsequence(betaEntry);

  assert.ok(hit, 'Expected a hit consequence on the target');
  assert.equal(hit.knockbackDistance, 0);
});

test('burning strike hand-trigger use adds fire tokens on attacked hexes', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 2, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  const interactions = [
    {
      id: 'hand-trigger:burning-strike:0:alpha:alpha',
      type: 'hand-trigger',
      beatIndex: 0,
      actorUserId: 'alpha',
      targetUserId: 'alpha',
      status: 'resolved',
      cardId: 'burning-strike',
      cardType: 'ability',
      attackHexes: [{ q: 1, r: 0 }],
      resolution: { use: true },
    },
  ];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const fireToken = (result.boardTokens ?? []).find(
    (token) => token?.type === 'fire-hex' && token?.position?.q === 1 && token?.position?.r === 0,
  );

  assert.ok(fireToken, 'Expected a fire hex token spawned by Burning Strike');
});

test('sinking shot hand-trigger use queues discard for the target', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 2, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const beats = [
    [
      buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];

  const interactions = [
    {
      id: 'hand-trigger:sinking-shot:0:alpha:beta',
      type: 'hand-trigger',
      beatIndex: 0,
      actorUserId: 'alpha',
      targetUserId: 'beta',
      status: 'resolved',
      cardId: 'sinking-shot',
      cardType: 'ability',
      resolution: { use: true },
    },
  ];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const discardInteraction = result.interactions.find(
    (item) => item?.type === 'discard' && item?.actorUserId === 'beta' && item?.discardCount === 2,
  );

  assert.ok(discardInteraction, 'Expected a discard interaction for the sinking shot target');
});

test('sinking shot queues discard even when the beat is already resolved', () => {
  const characters = [
    { userId: 'alpha', username: 'alpha', position: { q: 0, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Alpha' },
    { userId: 'beta', username: 'beta', position: { q: 2, r: 0 }, facing: 180, characterId: 'murelious', characterName: 'Beta' },
  ];

  const alphaEntry = buildEntry('alpha', 'W', 20, characters[0].position, characters[0].facing);
  const betaEntry = buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing);
  alphaEntry.calculated = true;
  betaEntry.calculated = true;

  const beats = [[alphaEntry, betaEntry]];

  const interactions = [
    {
      id: 'hand-trigger:sinking-shot:0:alpha:beta',
      type: 'hand-trigger',
      beatIndex: 0,
      actorUserId: 'alpha',
      targetUserId: 'beta',
      status: 'resolved',
      cardId: 'sinking-shot',
      cardType: 'ability',
      resolution: { use: true },
    },
  ];

  const result = executeBeatsWithInteractions(beats, characters, interactions);
  const discardInteraction = result.interactions.find(
    (item) => item?.type === 'discard' && item?.actorUserId === 'beta' && item?.discardCount === 2,
  );

  assert.ok(discardInteraction, 'Expected a discard interaction even when the beat is resolved');
});

test('sinking shot discard resolution does not prevent projectile hit damage', () => {
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
    [
      buildEntry('alpha', 'W', 0, characters[0].position, characters[0].facing),
      buildEntry('beta', 'W', 0, characters[1].position, characters[1].facing),
    ],
  ];
  beats[0][0].cardId = 'bow-shot';
  beats[0][0].passiveCardId = 'step';

  const handTriggerAvailability = new Map([['alpha', new Set(['sinking-shot'])]]);
  const initial = executeBeatsWithInteractions(
    beats,
    characters,
    [],
    undefined,
    new Map(),
    [],
    handTriggerAvailability,
  );
  const trigger = initial.interactions.find(
    (item) => item?.type === 'hand-trigger' && item?.cardId === 'sinking-shot',
  );
  assert.ok(trigger, 'Expected sinking shot to trigger on arrow hit');

  const resolvedTrigger = initial.interactions.map((item) =>
    item?.id === trigger.id
      ? { ...item, status: 'resolved', resolution: { use: true } }
      : item,
  );
  const withDiscard = executeBeatsWithInteractions(
    beats,
    characters,
    resolvedTrigger,
    undefined,
    new Map(),
    [],
    new Map(),
  );
  const discard = withDiscard.interactions.find((item) => item?.type === 'discard' && item?.actorUserId === 'beta');
  assert.ok(discard, 'Expected a discard interaction after sinking shot resolves');

  const resolvedDiscard = withDiscard.interactions.map((item) =>
    item?.id === discard.id ? { ...item, status: 'resolved' } : item,
  );
  const finalResult = executeBeatsWithInteractions(
    beats,
    characters,
    resolvedDiscard,
    undefined,
    new Map(),
    [],
    new Map(),
  );
  const beat2 = finalResult.beats[2] || [];
  const betaEntry = beat2.find((entry) => entry.username === 'beta');
  assert.ok(betaEntry);
  assert.equal(betaEntry.damage, 4);
});
