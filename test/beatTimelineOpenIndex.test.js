const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getCharacterFirstEIndex, getTimelineEarliestEIndex } = require('../dist/game/beatTimeline.js');

const createCharacter = (userId, username) => ({
  userId,
  username,
  position: { q: 0, r: 0 },
  facing: 0,
  characterId: 'murelious',
  characterName: username,
});

const buildEntry = (character, action, calculated = true) => ({
  username: character.username,
  action,
  rotation: '',
  priority: 0,
  damage: 0,
  location: { q: 0, r: 0 },
  facing: 0,
  calculated,
});

test('getCharacterFirstEIndex returns the next beat after the tail when no open beat exists', () => {
  const renix = createCharacter('u1', 'Renix');
  const anon = createCharacter('u2', 'anonymous1');
  const beats = [
    [buildEntry(renix, 'm'), buildEntry(anon, 'W')],
    [buildEntry(renix, 'm'), buildEntry(anon, 'X1')],
    [buildEntry(renix, 'Adr+1'), buildEntry(anon, '2m')],
  ];

  assert.equal(getCharacterFirstEIndex(beats, renix), 3);
  assert.equal(getCharacterFirstEIndex(beats, anon), 3);
  assert.equal(getTimelineEarliestEIndex(beats, [renix, anon]), 3);
});

test('getCharacterFirstEIndex still returns explicit open beats inside the timeline', () => {
  const renix = createCharacter('u1', 'Renix');
  const anon = createCharacter('u2', 'anonymous1');
  const beats = [
    [buildEntry(renix, 'm', true), buildEntry(anon, 'W', true)],
    [buildEntry(renix, 'E', false), buildEntry(anon, '2m', false)],
    [buildEntry(renix, 'Adr+1', false), buildEntry(anon, 'E', false)],
  ];

  assert.equal(getCharacterFirstEIndex(beats, renix), 1);
  assert.equal(getCharacterFirstEIndex(beats, anon), 2);
  assert.equal(getTimelineEarliestEIndex(beats, [renix, anon]), 1);
});

test('getCharacterFirstEIndex returns tail+1 when unresolved beats are all committed actions', () => {
  const renix = createCharacter('u1', 'Renix');
  const anon = createCharacter('u2', 'anonymous1');
  const beats = [
    [buildEntry(renix, 'm', true), buildEntry(anon, 'm', true)],
    [buildEntry(renix, 'a', true), buildEntry(anon, 'b', true)],
    [buildEntry(renix, 'Adr+1', false), buildEntry(anon, 'Co', false)],
    [buildEntry(renix, 'W', false), buildEntry(anon, 'Adr-1', false)],
  ];

  assert.equal(getCharacterFirstEIndex(beats, renix), 4);
  assert.equal(getCharacterFirstEIndex(beats, anon), 4);
  assert.equal(getTimelineEarliestEIndex(beats, [renix, anon]), 4);
});
