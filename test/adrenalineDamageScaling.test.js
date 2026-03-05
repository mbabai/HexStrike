const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCardCatalog } = require('../dist/game/cardCatalog.js');
const { createDeckState, validateActionSubmission } = require('../dist/game/cardRules.js');
const { applyActionSetToBeats } = require('../dist/game/actionSets.js');
const { executeBeats } = require('../dist/game/execute.js');

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

const findEntryForCharacter = (beat, character) =>
  beat.find((entry) => {
    if (!entry) return false;
    const key = entry.username ?? entry.userId ?? entry.userID;
    return key === character.username || key === character.userId;
  }) ?? null;

const findFirstBracketedEntry = (actionList) =>
  actionList.find((entry) => `${entry?.action ?? ''}`.trim().startsWith('[')) ?? null;

const buildActionListWithSubmittedAdrenaline = (catalog, activeCardId, passiveCardId, rotation, adrenaline) => {
  const deckState = createDeckState({ movement: [passiveCardId], ability: [activeCardId] });
  const submission = { activeCardId, passiveCardId, rotation };
  if (Number.isFinite(adrenaline)) {
    submission.adrenaline = adrenaline;
  }
  const validation = validateActionSubmission(submission, deckState, catalog);
  assert.equal(validation.ok, true, validation.ok ? '' : validation.error?.message);
  if (!validation.ok) {
    throw new Error(validation.error?.message ?? 'Failed to build action list.');
  }
  return validation.actionList.map((item) => ({
    ...item,
    submittedAdrenaline: Number.isFinite(adrenaline) ? adrenaline : 0,
  }));
};

const runSingleHitSimulation = (actionList) => {
  const actor = createCharacter('alpha', 'alpha', { q: 0, r: 0 }, 180);
  const target = createCharacter('beta', 'beta', { q: 1, r: 0 }, 180);
  const characters = [actor, target];
  const initialBeats = Array.from({ length: actionList.length }, () => [
    buildSeedEntry(actor, 'E'),
    buildSeedEntry(target, 'W'),
  ]);
  const withActions = applyActionSetToBeats(initialBeats, characters, actor.userId, actionList, []);
  const result = executeBeats(withActions, characters);
  const attackBeatIndex = actionList.findIndex((item) => `${item.action ?? ''}`.toLowerCase().includes('a'));
  assert.ok(attackBeatIndex >= 0, 'Expected attack action in action list.');
  const attackBeat = result.beats[attackBeatIndex] ?? [];
  const targetAttackBeatEntry = findEntryForCharacter(attackBeat, target);
  assert.ok(targetAttackBeatEntry, 'Expected target beat entry on attack beat.');
  return Number(targetAttackBeatEntry.damage ?? 0);
};

test('smash attack {adrX} adds submitted adrenaline to {i} damage', async () => {
  const catalog = await loadCardCatalog();
  const actionList = buildActionListWithSubmittedAdrenaline(catalog, 'smash-attack', 'step', '0', 4);
  const targetDamageOnHit = runSingleHitSimulation(actionList);
  assert.equal(targetDamageOnHit, 9);
});

test('hammer {adrX} adds submitted adrenaline to {i} damage', async () => {
  const catalog = await loadCardCatalog();
  const actionList = buildActionListWithSubmittedAdrenaline(catalog, 'hammer', 'step', '0', 3);
  const targetDamageOnHit = runSingleHitSimulation(actionList);
  assert.equal(targetDamageOnHit, 9);
});

test('submitted adrenaline defaults to zero for {adrX} damage scaling', async () => {
  const catalog = await loadCardCatalog();
  const actionList = buildActionListWithSubmittedAdrenaline(catalog, 'smash-attack', 'step', '0', 0);
  const targetDamageOnHit = runSingleHitSimulation(actionList);
  assert.equal(targetDamageOnHit, 5);
});

test('double-daggers {adrX} adds submitted adrenaline to the bracketed damage', async () => {
  const catalog = await loadCardCatalog();
  const actionList = buildActionListWithSubmittedAdrenaline(catalog, 'double-daggers', 'step', '0', 4);
  const bracketedEntry = findFirstBracketedEntry(actionList);

  assert.ok(bracketedEntry);
  assert.equal(bracketedEntry.damage, 7);
});

test('hip-throw {adrX} caps its damage bonus at 4', async () => {
  const catalog = await loadCardCatalog();
  const actionList = buildActionListWithSubmittedAdrenaline(catalog, 'hip-throw', 'step', '0', 6);
  const bracketedEntry = findFirstBracketedEntry(actionList);

  assert.ok(bracketedEntry);
  assert.equal(bracketedEntry.damage, 7);
});

test('tackle {adrX} caps its damage bonus at 4', async () => {
  const catalog = await loadCardCatalog();
  const actionList = buildActionListWithSubmittedAdrenaline(catalog, 'tackle', 'step', '0', 6);
  const bracketedEntry = findFirstBracketedEntry(actionList);

  assert.ok(bracketedEntry);
  assert.equal(bracketedEntry.damage, 6);
});

test('push-kick {adrX} caps its damage bonus at 5', async () => {
  const catalog = await loadCardCatalog();
  const actionList = buildActionListWithSubmittedAdrenaline(catalog, 'push-kick', 'step', '0', 6);
  const bracketedEntry = findFirstBracketedEntry(actionList);

  assert.ok(bracketedEntry);
  assert.equal(bracketedEntry.damage, 5);
});
