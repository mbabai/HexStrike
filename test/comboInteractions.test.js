const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCardCatalog } = require('../dist/game/cardCatalog.js');
const { createDeckState, validateActionSubmission } = require('../dist/game/cardRules.js');
const { executeBeatsWithInteractions } = require('../dist/game/execute.js');

const ACTOR_ID = 'alpha';
const TARGET_ID = 'beta';
const COMBO_ACTION = 'CO';
const THROW_KEYWORD_REGEX = /\bthrow\b/i;

const normalizeActionLabel = (value) => {
  const trimmed = `${value ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const cardHasCombo = (card) =>
  Array.isArray(card?.actions) &&
  card.actions.some((action) => normalizeActionLabel(action).toUpperCase() === COMBO_ACTION);

const axialDistance = (coord) =>
  (Math.abs(coord.q) + Math.abs(coord.r) + Math.abs(coord.q + coord.r)) / 2;

const buildCandidatePositions = (radius) => {
  const positions = [];
  for (let q = -radius; q <= radius; q += 1) {
    for (let r = -radius; r <= radius; r += 1) {
      const coord = { q, r };
      if (axialDistance(coord) <= radius) {
        positions.push(coord);
      }
    }
  }
  return positions;
};

const buildBeatEntry = (username, action, rotation, priority, position, facing, extra = {}) => ({
  username,
  action,
  rotation,
  priority,
  damage: 0,
  location: { q: position.q, r: position.r },
  facing,
  calculated: false,
  ...extra,
});

const buildBeatsFromActionList = (actionList, actor, target) =>
  actionList.map((item) => {
    const extra = {};
    if (item.interaction) {
      extra.interaction = item.interaction;
    }
    if (Number.isFinite(item.damage)) {
      extra.attackDamage = item.damage;
    }
    if (Number.isFinite(item.kbf)) {
      extra.attackKbf = item.kbf;
    }
    if (item.cardId) {
      extra.cardId = item.cardId;
    }
    if (item.passiveCardId) {
      extra.passiveCardId = item.passiveCardId;
    }
    return [
      buildBeatEntry(actor.username, item.action, item.rotation, item.priority, actor.position, actor.facing, extra),
      buildBeatEntry(target.username, 'W', '', 0, target.position, target.facing),
    ];
  });

const buildActionList = (catalog, activeCardId, passiveCardId) => {
  const activeCard = catalog.cardsById.get(activeCardId);
  const passiveCard = catalog.cardsById.get(passiveCardId);
  assert.ok(activeCard, `Missing active card ${activeCardId}`);
  assert.ok(passiveCard, `Missing passive card ${passiveCardId}`);
  assert.notEqual(
    activeCard.type,
    passiveCard.type,
    `Expected active/passive card types to differ for ${activeCardId}`,
  );
  const movementCardId = activeCard.type === 'movement' ? activeCard.id : passiveCard.id;
  const abilityCardId = activeCard.type === 'ability' ? activeCard.id : passiveCard.id;
  const deckState = createDeckState({ movement: [movementCardId], ability: [abilityCardId] });
  const result = validateActionSubmission(
    { activeCardId, passiveCardId, rotation: '0' },
    deckState,
    catalog,
  );
  assert.equal(result.ok, true, `Expected valid action list for ${activeCardId}`);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.actionList;
};

const getCoIndex = (actionList) =>
  actionList.findIndex((item) => normalizeActionLabel(item.action).toUpperCase() === COMBO_ACTION);

const runSimulation = (actionList, targetPosition, comboAvailability) => {
  const actor = {
    userId: ACTOR_ID,
    username: ACTOR_ID,
    characterId: 'murelious',
    characterName: 'Alpha',
    position: { q: 0, r: 0 },
    facing: 180,
  };
  const target = {
    userId: TARGET_ID,
    username: TARGET_ID,
    characterId: 'murelious',
    characterName: 'Beta',
    position: { q: targetPosition.q, r: targetPosition.r },
    facing: 180,
  };
  const beats = buildBeatsFromActionList(actionList, actor, target);
  return executeBeatsWithInteractions(beats, [actor, target], [], undefined, comboAvailability);
};

const findComboTarget = (actionList, candidates, comboAvailability) => {
  for (const position of candidates) {
    const result = runSimulation(actionList, position, comboAvailability);
    const combo = result.interactions.find(
      (interaction) => interaction.type === 'combo' && interaction.status === 'pending',
    );
    if (combo) {
      return { position, result, combo };
    }
  }
  return null;
};

test('combo cards open combo interactions on hit and suppress them when throw is active', async () => {
  const catalog = await loadCardCatalog();
  const cards = [...catalog.movement, ...catalog.ability];
  const comboCards = cards.filter(cardHasCombo);
  assert.ok(comboCards.length > 0, 'Expected combo cards in catalog');

  const throwPassiveMovement = catalog.cardsById.get('leap');
  assert.ok(throwPassiveMovement, 'Expected leap to exist as a throw passive card');
  assert.equal(throwPassiveMovement.type, 'movement', 'Expected leap to be a movement card');

  const nonThrowMovement = catalog.movement.find((card) => {
    if (!card) return false;
    if (card.id === throwPassiveMovement.id) return false;
    const text = `${card.activeText ?? ''} ${card.passiveText ?? ''}`;
    return !THROW_KEYWORD_REGEX.test(text);
  });
  assert.ok(nonThrowMovement, 'Expected a non-throw movement card for passive pairing');

  const nonThrowAbility = catalog.ability.find((card) => {
    if (!card) return false;
    const text = `${card.passiveText ?? ''}`;
    return !THROW_KEYWORD_REGEX.test(text);
  });
  assert.ok(nonThrowAbility, 'Expected a non-throw ability card for passive pairing');

  const throwPassiveAbility = catalog.ability.find((card) => {
    if (!card) return false;
    const text = `${card.passiveText ?? ''}`;
    return THROW_KEYWORD_REGEX.test(text);
  }) ?? null;

  const candidates = buildCandidatePositions(4);
  const comboAvailability = new Map([[ACTOR_ID, true]]);

  for (const card of comboCards) {
    const passiveCardId = card.type === 'ability' ? nonThrowMovement.id : nonThrowAbility.id;
    const actionList = buildActionList(catalog, card.id, passiveCardId);
    const coIndex = getCoIndex(actionList);
    assert.notEqual(coIndex, -1, `Expected Co step for ${card.id}`);

    const found = findComboTarget(actionList, candidates, comboAvailability);
    assert.ok(found, `Expected combo interaction for ${card.id}`);
    assert.equal(found.combo.actorUserId, ACTOR_ID, `${card.id} combo actor mismatch`);
    assert.equal(found.combo.beatIndex, coIndex, `${card.id} combo beat mismatch`);
    const coEntry = found.result.beats?.[coIndex]?.find((entry) => entry.username === ACTOR_ID);
    assert.ok(coEntry, `${card.id} missing Co entry`);
    assert.equal(Boolean(coEntry.comboSkipped), false, `${card.id} combo should not be skipped`);

    const throwPassiveId =
      card.type === 'ability' ? throwPassiveMovement.id : throwPassiveAbility ? throwPassiveAbility.id : null;
    if (throwPassiveId) {
      const throwActionList = buildActionList(catalog, card.id, throwPassiveId);
      const throwResult = runSimulation(throwActionList, found.position, comboAvailability);
      const hasCombo = throwResult.interactions.some((interaction) => interaction.type === 'combo');
      const hasThrow = throwResult.interactions.some((interaction) => interaction.type === 'throw');
      assert.equal(hasCombo, false, `${card.id} should not open combo after throw interaction`);
      assert.equal(hasThrow, true, `${card.id} should open a throw interaction instead`);
    }
  }
});

test('combo prompts are suppressed when the Co entry is tagged as throw even if the attack entry lacks throw metadata', () => {
  const actor = {
    userId: ACTOR_ID,
    username: ACTOR_ID,
    characterId: 'murelious',
    characterName: 'Alpha',
    position: { q: 0, r: 0 },
    facing: 180,
  };
  const target = {
    userId: TARGET_ID,
    username: TARGET_ID,
    characterId: 'murelious',
    characterName: 'Beta',
    position: { q: 1, r: 0 },
    facing: 180,
  };

  const beats = [
    [
      buildBeatEntry(actor.username, '[a]', '', 20, actor.position, actor.facing, { cardId: 'combo-card' }),
      buildBeatEntry(target.username, 'W', '', 0, target.position, target.facing),
    ],
    [
      buildBeatEntry(actor.username, 'Co', '', 0, actor.position, actor.facing, {
        cardId: 'combo-card',
        passiveCardId: 'leap',
      }),
      buildBeatEntry(target.username, 'W', '', 0, target.position, target.facing),
    ],
  ];

  const comboAvailability = new Map([[ACTOR_ID, true]]);
  const result = executeBeatsWithInteractions(beats, [actor, target], [], undefined, comboAvailability);
  const hasCombo = result.interactions.some((interaction) => interaction.type === 'combo');
  assert.equal(hasCombo, false);
  const coEntry = result.beats?.[1]?.find((entry) => entry.username === ACTOR_ID);
  assert.ok(coEntry);
  assert.equal(coEntry.comboSkipped, true);
});

test('non-combo throw cards do not open combo interactions', async () => {
  const catalog = await loadCardCatalog();
  const hipThrow = catalog.cardsById.get('hip-throw');
  const backflip = catalog.cardsById.get('backflip');
  assert.ok(hipThrow, 'Expected hip-throw to exist');
  assert.ok(backflip, 'Expected backflip to exist');

  const actionList = buildActionList(catalog, hipThrow.id, backflip.id);
  const comboAvailability = new Map([[ACTOR_ID, true]]);
  const result = runSimulation(actionList, { q: 1, r: 0 }, comboAvailability);
  const hasCombo = result.interactions.some((interaction) => interaction.type === 'combo');
  const hasThrow = result.interactions.some((interaction) => interaction.type === 'throw');
  assert.equal(hasCombo, false);
  assert.equal(hasThrow, true);
});

test('combo prompts do not reopen after being skipped in history', () => {
  const actor = {
    userId: ACTOR_ID,
    username: ACTOR_ID,
    characterId: 'murelious',
    characterName: 'Alpha',
    position: { q: 0, r: 0 },
    facing: 180,
  };
  const target = {
    userId: TARGET_ID,
    username: TARGET_ID,
    characterId: 'murelious',
    characterName: 'Beta',
    position: { q: 1, r: 0 },
    facing: 180,
  };
  const beats = [
    [
      buildBeatEntry(actor.username, '1a', '', 20, actor.position, actor.facing, {
        cardId: 'combo-card',
        attackDamage: 2,
        attackKbf: 0,
      }),
      buildBeatEntry(target.username, 'W', '', 0, target.position, target.facing),
    ],
    [
      buildBeatEntry(actor.username, 'Co', '', 0, actor.position, actor.facing, { cardId: 'combo-card' }),
      buildBeatEntry(target.username, 'W', '', 0, target.position, target.facing),
    ],
  ];

  const first = executeBeatsWithInteractions(beats, [actor, target], [], undefined, new Map([[ACTOR_ID, false]]));
  const firstCombo = first.interactions.some((interaction) => interaction.type === 'combo');
  assert.equal(firstCombo, false);
  const firstCoEntry = first.beats?.[1]?.find((entry) => entry.username === ACTOR_ID);
  assert.ok(firstCoEntry);
  assert.equal(firstCoEntry.comboSkipped, true);

  const second = executeBeatsWithInteractions(
    first.beats,
    [actor, target],
    [],
    undefined,
    new Map([[ACTOR_ID, true]]),
  );
  const secondCombo = second.interactions.filter(
    (interaction) => interaction.type === 'combo' && interaction.status === 'pending',
  );
  assert.equal(secondCombo.length, 0);
  const secondCoEntry = second.beats?.[1]?.find((entry) => entry.username === ACTOR_ID);
  assert.ok(secondCoEntry);
  assert.equal(secondCoEntry.comboSkipped, true);
});

test('combo follow-ups trigger even when starting after a non-E beat', () => {
  const actor = {
    userId: ACTOR_ID,
    username: ACTOR_ID,
    characterId: 'murelious',
    characterName: 'Alpha',
    position: { q: 0, r: 0 },
    facing: 180,
  };
  const target = {
    userId: TARGET_ID,
    username: TARGET_ID,
    characterId: 'murelious',
    characterName: 'Beta',
    position: { q: 1, r: 0 },
    facing: 180,
  };
  const beats = [
    [
      buildBeatEntry(actor.username, 'W', '', 10, actor.position, actor.facing),
      buildBeatEntry(target.username, 'W', '', 0, target.position, target.facing),
    ],
    [
      buildBeatEntry(actor.username, 'c', '', 20, actor.position, actor.facing, {
        cardId: 'chase',
        comboStarter: true,
        attackDamage: 2,
        attackKbf: 0,
      }),
      buildBeatEntry(target.username, 'W', '', 0, target.position, target.facing),
    ],
    [
      buildBeatEntry(actor.username, 'Co', '', 0, actor.position, actor.facing, { cardId: 'chase' }),
      buildBeatEntry(target.username, 'W', '', 0, target.position, target.facing),
    ],
  ];

  const comboAvailability = new Map([[ACTOR_ID, true]]);
  const result = executeBeatsWithInteractions(beats, [actor, target], [], undefined, comboAvailability);
  const hasCombo = result.interactions.some(
    (interaction) => interaction.type === 'combo' && interaction.status === 'pending',
  );
  assert.equal(hasCombo, true);
});
