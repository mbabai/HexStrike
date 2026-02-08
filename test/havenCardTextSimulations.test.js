const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCardCatalog } = require('../dist/game/cardCatalog.js');
const { createDeckState, validateActionSubmission, resolveLandRefreshes } = require('../dist/game/cardRules.js');
const { applyActionSetToBeats } = require('../dist/game/actionSets.js');
const { executeBeats, executeBeatsWithInteractions } = require('../dist/game/execute.js');
const { DEFAULT_LAND_HEXES } = require('../dist/game/hexGrid.js');

const buildCharacter = (userId, username, position, facing = 180) => ({
  userId,
  username,
  characterId: 'murelious',
  characterName: username,
  position: { q: position.q, r: position.r },
  facing,
});

const buildEntry = (character, action = 'E') => ({
  username: character.username,
  action,
  rotation: '',
  priority: 0,
  damage: 0,
  location: { q: character.position.q, r: character.position.r },
  terrain: 'abyss',
  facing: character.facing,
  calculated: true,
});

const findEntry = (beat, character) =>
  (beat ?? []).find((entry) => {
    const key = entry?.username ?? entry?.userId ?? entry?.userID;
    return key === character.userId || key === character.username;
  }) ?? null;

test('Haven active creates a touching interaction and places an abyss platform when resolved', async () => {
  const catalog = await loadCardCatalog();
  const deckState = createDeckState({ movement: ['step'], ability: ['haven'] });
  const validation = validateActionSubmission(
    { activeCardId: 'haven', passiveCardId: 'step', rotation: 'R1' },
    deckState,
    catalog,
  );
  assert.equal(validation.ok, true, validation.ok ? '' : validation.error?.message);
  if (!validation.ok) return;

  const actor = buildCharacter('alpha', 'alpha', { q: -4, r: 0 });
  const target = buildCharacter('beta', 'beta', { q: 20, r: 0 });
  const baseBeats = Array.from({ length: validation.actionList.length }, () => [
    buildEntry(actor, 'E'),
    buildEntry(target, 'W'),
  ]);
  baseBeats.forEach((beat) => {
    beat[0].calculated = false;
    beat[0].terrain = 'abyss';
    beat[1].calculated = false;
    beat[1].terrain = 'abyss';
  });
  const beats = applyActionSetToBeats(baseBeats, [actor, target], actor.userId, validation.actionList, []);

  const pending = executeBeatsWithInteractions(beats, [actor, target], [], DEFAULT_LAND_HEXES);
  const interaction = (pending.interactions ?? []).find((item) => item?.type === 'haven-platform');
  assert.ok(interaction, 'Expected Haven to create a pending interaction');
  assert.equal(interaction.status, 'pending');
  assert.equal(interaction.actorUserId, actor.userId);
  assert.equal(interaction.beatIndex, 1);
  const touching = Array.isArray(interaction.touchingHexes) ? interaction.touchingHexes : [];
  assert.equal(new Set(touching.map((coord) => `${coord.q},${coord.r}`)).size, 7);

  const resolved = {
    ...interaction,
    status: 'resolved',
    resolution: { targetHex: { q: -4, r: 0 } },
  };
  const resolvedResult = executeBeatsWithInteractions(beats, [actor, target], [resolved], DEFAULT_LAND_HEXES);
  const platform = (resolvedResult.boardTokens ?? []).find((token) => token?.type === 'ethereal-platform');
  assert.ok(platform, 'Expected abyss target to spawn an ethereal platform');
  assert.deepEqual(platform.position, { q: -4, r: 0 });
});

test('Haven active target on land immediately disappears', async () => {
  const catalog = await loadCardCatalog();
  const deckState = createDeckState({ movement: ['step'], ability: ['haven'] });
  const validation = validateActionSubmission(
    { activeCardId: 'haven', passiveCardId: 'step', rotation: 'R1' },
    deckState,
    catalog,
  );
  assert.equal(validation.ok, true, validation.ok ? '' : validation.error?.message);
  if (!validation.ok) return;

  const actor = buildCharacter('alpha', 'alpha', { q: -3, r: 0 });
  const target = buildCharacter('beta', 'beta', { q: 20, r: 0 });
  const baseBeats = Array.from({ length: validation.actionList.length }, () => [
    buildEntry(actor, 'E'),
    buildEntry(target, 'W'),
  ]);
  baseBeats.forEach((beat) => {
    beat[0].calculated = false;
    beat[0].terrain = 'abyss';
    beat[1].calculated = false;
    beat[1].terrain = 'abyss';
  });
  const beats = applyActionSetToBeats(baseBeats, [actor, target], actor.userId, validation.actionList, []);

  const interaction = {
    id: 'haven-platform:0:alpha:alpha',
    type: 'haven-platform',
    beatIndex: 0,
    actorUserId: actor.userId,
    targetUserId: actor.userId,
    status: 'resolved',
    resolution: { targetHex: { q: -2, r: 0 } },
  };
  const result = executeBeatsWithInteractions(beats, [actor, target], [interaction], DEFAULT_LAND_HEXES);
  const platform = (result.boardTokens ?? []).find((token) => token?.type === 'ethereal-platform');
  assert.equal(Boolean(platform), false);
});

test('Haven passive skips the first W on abyss movement timelines', async () => {
  const catalog = await loadCardCatalog();
  const deckState = createDeckState({ movement: ['step'], ability: ['haven'] });
  const validation = validateActionSubmission(
    { activeCardId: 'step', passiveCardId: 'haven', rotation: 'R1' },
    deckState,
    catalog,
  );
  assert.equal(validation.ok, true, validation.ok ? '' : validation.error?.message);
  if (!validation.ok) return;

  const actor = buildCharacter('alpha', 'alpha', { q: -4, r: 0 });
  const target = buildCharacter('beta', 'beta', { q: 20, r: 0 });
  const baseBeats = Array.from({ length: validation.actionList.length }, () => [
    buildEntry(actor, 'E'),
    buildEntry(target, 'W'),
  ]);
  baseBeats.forEach((beat) => {
    beat[0].calculated = false;
    beat[0].terrain = 'abyss';
    beat[1].calculated = false;
    beat[1].terrain = 'abyss';
  });

  const withActions = applyActionSetToBeats(baseBeats, [actor, target], actor.userId, validation.actionList, []);
  const result = executeBeats(withActions, [actor, target], DEFAULT_LAND_HEXES);

  const beat0 = findEntry(result.beats[0], actor);
  const beat1 = findEntry(result.beats[1], actor);
  const beat2 = findEntry(result.beats[2], actor);
  assert.ok(beat0);
  assert.ok(beat1);
  assert.ok(beat2);
  assert.equal(beat0.action, 'm');
  assert.equal(beat0.rotation, 'R1');
  assert.equal(beat1.action, 'W');
  assert.equal(beat2.action, 'E');
});

test('Haven passive does not skip the first W while on land', async () => {
  const catalog = await loadCardCatalog();
  const deckState = createDeckState({ movement: ['step'], ability: ['haven'] });
  const validation = validateActionSubmission(
    { activeCardId: 'step', passiveCardId: 'haven', rotation: 'R1' },
    deckState,
    catalog,
  );
  assert.equal(validation.ok, true, validation.ok ? '' : validation.error?.message);
  if (!validation.ok) return;

  const actor = buildCharacter('alpha', 'alpha', { q: 0, r: 0 });
  const target = buildCharacter('beta', 'beta', { q: 20, r: 0 });
  const baseBeats = Array.from({ length: validation.actionList.length }, () => [
    buildEntry(actor, 'E'),
    buildEntry(target, 'W'),
  ]);
  baseBeats.forEach((beat) => {
    beat[0].calculated = false;
    beat[0].terrain = 'land';
    beat[1].calculated = false;
    beat[1].terrain = 'abyss';
  });

  const withActions = applyActionSetToBeats(baseBeats, [actor, target], actor.userId, validation.actionList, []);
  const result = executeBeats(withActions, [actor, target], DEFAULT_LAND_HEXES);
  const beat0 = findEntry(result.beats[0], actor);
  assert.ok(beat0);
  assert.equal(beat0.action, 'W');
});

test('Ethereal platform grants refresh on abyss E and is consumed', () => {
  const actor = buildCharacter('alpha', 'alpha', { q: -4, r: 0 });
  const beats = [[buildEntry(actor, 'E')]];
  beats[0][0].terrain = 'abyss';

  const deckState = createDeckState({
    movement: ['step', 'dash', 'jump', 'backflip'],
    ability: ['haven', 'jab', 'guard', 'parry', 'trip'],
  });
  deckState.abilityHand = ['haven'];
  deckState.abilityDeck = ['jab', 'guard', 'parry', 'trip'];
  const deckStates = new Map([[actor.userId, deckState]]);
  const interactions = [
    {
      id: 'haven-platform:0:alpha:alpha',
      type: 'haven-platform',
      beatIndex: 0,
      actorUserId: actor.userId,
      targetUserId: actor.userId,
      status: 'resolved',
      resolution: { targetHex: { q: -4, r: 0 } },
    },
  ];
  const boardTokens = [
    { id: 'ethereal-platform:0', type: 'ethereal-platform', position: { q: -4, r: 0 }, facing: 0, ownerUserId: actor.userId },
  ];

  resolveLandRefreshes(
    deckStates,
    beats,
    [actor],
    DEFAULT_LAND_HEXES,
    interactions,
    undefined,
    boardTokens,
  );

  assert.equal(deckState.lastRefreshIndex, 0);
  assert.equal(deckState.abilityHand.length, 4);
  assert.equal(boardTokens.length, 0);
  assert.equal(interactions[0].resolution.consumedBeatIndex, 0);
});
