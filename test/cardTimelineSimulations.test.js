const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCardCatalog } = require('../dist/game/cardCatalog.js');
const { createDeckState, validateActionSubmission } = require('../dist/game/cardRules.js');
const { applyActionSetToBeats } = require('../dist/game/actionSets.js');
const { executeBeats } = require('../dist/game/execute.js');

const ROTATION_LABELS = ['R1', '0', 'R2', '3', 'L2', 'L1'];
const ABYSS_START = { q: -4, r: 0 };
const DEFAULT_START = { q: 0, r: 0 };
const FAR_TARGET_START = { q: 20, r: 0 };

const ABILITY_PASSIVE_ACTIVE_OVERRIDES = new Map([
  ['aerial-strike', 'advance'],
  ['cross-slash', 'dash'],
  ['flying-knee', 'dash'],
  ['push-kick', 'dash'],
  ['smash-attack', 'leap'],
  ['smoke-bomb', 'dash'],
  ['whirlwind', 'advance'],
  ['gigantic-staff', 'step'],
]);

const MOVEMENT_PASSIVE_ACTIVE_OVERRIDES = new Map([
  ['fleche', 'balestra-lunge'],
  ['ninja-roll', 'balestra-lunge'],
]);

const resolveCardTypePool = (catalog, type) => (type === 'movement' ? catalog.movement : catalog.ability);

const pickCardIdByPreference = (catalog, type, preferredIds = []) => {
  for (const id of preferredIds) {
    if (!id) continue;
    const card = catalog.cardsById.get(id);
    if (card?.type === type) return card.id;
  }
  const fallback = resolveCardTypePool(catalog, type)[0];
  return fallback?.id ?? null;
};

const createCharacter = (userId, username, position, facing) => ({
  userId,
  username,
  position: { q: position.q, r: position.r },
  facing,
  characterId: 'murelious',
  characterName: username,
});

const buildSeedEntry = (character, action = 'E') => ({
  username: character.username,
  action,
  rotation: '',
  priority: 0,
  damage: 0,
  location: { q: character.position.q, r: character.position.r },
  facing: character.facing,
  calculated: false,
});

const getRotationMagnitude = (label) => {
  const value = `${label ?? ''}`.trim().toUpperCase();
  if (value === '0') return 0;
  if (value === '3') return 3;
  if (value.startsWith('L') || value.startsWith('R')) {
    const amount = Number(value.slice(1));
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
};

const buildAllowedRotationSet = (restriction) => {
  const trimmed = `${restriction ?? ''}`.trim();
  if (!trimmed || trimmed === '*') return null;
  const [minRaw, maxRaw] = trimmed.split('-');
  const min = Number(minRaw);
  const max = Number(maxRaw);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const allowed = new Set();
  for (const label of ['0', 'R1', 'R2', '3', 'L2', 'L1']) {
    const magnitude = getRotationMagnitude(label);
    if (magnitude == null) continue;
    if (magnitude >= min && magnitude <= max) {
      allowed.add(label);
    }
  }
  return allowed;
};

const isRotationAllowed = (card, rotation) => {
  const allowed = buildAllowedRotationSet(card?.rotations);
  return !allowed || allowed.has(rotation);
};

const pickRotationForCard = (activeCard) => {
  const selected = ROTATION_LABELS.find((rotation) => isRotationAllowed(activeCard, rotation));
  assert.ok(selected, `No allowed rotation for ${activeCard.id}`);
  return selected;
};

const findEntryForCharacter = (beat, character) =>
  beat.find((entry) => {
    if (!entry) return false;
    const key = entry.username ?? entry.userId ?? entry.userID;
    return key === character.username || key === character.userId;
  }) ?? null;

const choosePassiveCardForActiveCase = (catalog, activeCard) => {
  if (activeCard.type === 'ability') {
    return pickCardIdByPreference(catalog, 'movement', ['step', 'advance', 'dash', 'jump']);
  }
  return pickCardIdByPreference(catalog, 'ability', ['balestra-lunge', 'double-daggers', 'feint']);
};

const chooseActiveCardForPassiveCase = (catalog, passiveCard) => {
  if (passiveCard.type === 'ability') {
    const override = ABILITY_PASSIVE_ACTIVE_OVERRIDES.get(passiveCard.id);
    return pickCardIdByPreference(catalog, 'movement', [override, 'step', 'dash', 'advance', 'leap']);
  }
  const override = MOVEMENT_PASSIVE_ACTIVE_OVERRIDES.get(passiveCard.id);
  return pickCardIdByPreference(catalog, 'ability', [override, 'balestra-lunge', 'double-daggers', 'long-thrust']);
};

const buildActionList = (catalog, activeCardId, passiveCardId) => {
  const activeCard = catalog.cardsById.get(activeCardId);
  const passiveCard = catalog.cardsById.get(passiveCardId);
  assert.ok(activeCard, `Missing active card ${activeCardId}`);
  assert.ok(passiveCard, `Missing passive card ${passiveCardId}`);
  assert.notEqual(
    activeCard.type,
    passiveCard.type,
    `Expected active/passive to be opposite types (${activeCardId}, ${passiveCardId})`,
  );
  const movementCardId = activeCard.type === 'movement' ? activeCard.id : passiveCard.id;
  const abilityCardId = activeCard.type === 'ability' ? activeCard.id : passiveCard.id;
  const deckState = createDeckState({ movement: [movementCardId], ability: [abilityCardId] });
  const rotation = pickRotationForCard(activeCard);
  const result = validateActionSubmission(
    { activeCardId, passiveCardId, rotation },
    deckState,
    catalog,
  );
  assert.equal(result.ok, true, result.ok ? '' : result.error?.message);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.actionList;
};

const simulateTimeline = (actionList, options = {}) => {
  const actor = createCharacter('alpha', 'alpha', options.actorStart ?? DEFAULT_START, 180);
  const target = createCharacter('beta', 'beta', options.targetStart ?? FAR_TARGET_START, 180);
  const characters = [actor, target];
  const initialBeats = Array.from({ length: actionList.length }, () => [
    buildSeedEntry(actor, 'E'),
    buildSeedEntry(target, 'W'),
  ]);
  const withActions = applyActionSetToBeats(initialBeats, characters, actor.userId, actionList, []);
  const result = executeBeats(withActions, characters);
  const actorTimeline = [];
  for (let index = 0; index < actionList.length; index += 1) {
    const beat = result.beats[index] ?? [];
    const entry = findEntryForCharacter(beat, actor);
    assert.ok(entry, `Missing actor entry at beat ${index}`);
    actorTimeline.push(entry);
  }
  return { actorTimeline };
};

const assertTimelineMatchesActionList = (actionList, actorTimeline, label) => {
  assert.equal(actorTimeline.length, actionList.length, `${label}: timeline length mismatch`);
  for (let index = 0; index < actionList.length; index += 1) {
    const expected = actionList[index];
    const actual = actorTimeline[index];
    assert.equal(actual.action, expected.action, `${label}: action mismatch at beat ${index}`);
    assert.equal(actual.rotation ?? '', expected.rotation ?? '', `${label}: rotation mismatch at beat ${index}`);
    assert.equal(
      actual.rotationSource ?? undefined,
      expected.rotationSource ?? undefined,
      `${label}: rotation source mismatch at beat ${index}`,
    );
    assert.equal(actual.cardId ?? '', expected.cardId ?? '', `${label}: cardId mismatch at beat ${index}`);
    assert.equal(
      actual.passiveCardId ?? '',
      expected.passiveCardId ?? '',
      `${label}: passiveCardId mismatch at beat ${index}`,
    );
    assert.equal(
      Number(actual.attackDamage ?? 0),
      Number(expected.damage ?? 0),
      `${label}: attack damage mismatch at beat ${index}`,
    );
    assert.equal(
      Number(actual.attackKbf ?? 0),
      Number(expected.kbf ?? 0),
      `${label}: attack KBF mismatch at beat ${index}`,
    );
    assert.equal(
      actual.interaction?.type ?? '',
      expected.interaction?.type ?? '',
      `${label}: interaction mismatch at beat ${index}`,
    );
  }
};

test('card timeline simulations cover active and passive roles for every catalog card', async (t) => {
  const catalog = await loadCardCatalog();
  const cards = [...catalog.movement, ...catalog.ability];
  assert.ok(cards.length > 0, 'Expected cards in catalog');

  const completionLog = new Map(cards.map((card) => [card.id, { active: false, passive: false }]));

  for (const card of cards) {
    await t.test(`[active] ${card.id}`, () => {
      const passiveCardId = choosePassiveCardForActiveCase(catalog, card);
      assert.ok(passiveCardId, `No passive pair found for active card ${card.id}`);
      const actionList = buildActionList(catalog, card.id, passiveCardId);
      const { actorTimeline } = simulateTimeline(actionList);
      assertTimelineMatchesActionList(actionList, actorTimeline, `active ${card.id}`);
      completionLog.get(card.id).active = true;
    });

    await t.test(`[passive] ${card.id}`, () => {
      const activeCardId = chooseActiveCardForPassiveCase(catalog, card);
      assert.ok(activeCardId, `No active pair found for passive card ${card.id}`);
      const actionList = buildActionList(catalog, activeCardId, card.id);
      const actorStart = card.id === 'gigantic-staff' ? ABYSS_START : DEFAULT_START;
      const { actorTimeline } = simulateTimeline(actionList, { actorStart });
      if (card.id === 'gigantic-staff') {
        const expected = actionList.map((entry, index) =>
          index === 1 ? { ...entry, action: '2j' } : entry,
        );
        assertTimelineMatchesActionList(expected, actorTimeline, `passive ${card.id}`);
      } else {
        assertTimelineMatchesActionList(actionList, actorTimeline, `passive ${card.id}`);
      }
      completionLog.get(card.id).passive = true;
    });
  }

  const missing = [];
  for (const [id, status] of completionLog.entries()) {
    if (!status.active || !status.passive) {
      missing.push(`${id}: active=${status.active}, passive=${status.passive}`);
    }
  }
  assert.deepEqual(missing, [], `Missing role coverage:\n${missing.join('\n')}`);
});
