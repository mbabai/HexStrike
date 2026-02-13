const { test } = require('node:test');
const assert = require('node:assert/strict');

const loadModule = async () => import('../public/replayShare.mjs');

const buildReplay = () => ({
  id: 'history-1',
  sourceGameId: 'game-1',
  sourceMatchId: 'match-1',
  createdAt: '2026-02-12T12:34:56.000Z',
  players: [
    { userId: 'u1', username: 'Alice', characterId: 'murelious', characterName: 'Murelious' },
    { userId: 'u2', username: 'Bob', characterId: 'strylan', characterName: 'Strylan' },
  ],
  state: {
    public: {
      land: [],
      beats: [],
      timeline: [],
      characters: [],
      customInteractions: [],
    },
  },
});

test('normalizeReplayPayload accepts state with public payload', async () => {
  const { normalizeReplayPayload } = await loadModule();
  const replay = buildReplay();
  const normalized = normalizeReplayPayload(replay);
  assert.equal(normalized?.id, replay.id);
  assert.equal(normalized?.sourceGameId, replay.sourceGameId);
  assert.equal(normalized?.players?.length, 2);
});

test('normalizeReplayPayload returns null when public state is missing', async () => {
  const { normalizeReplayPayload } = await loadModule();
  const normalized = normalizeReplayPayload({ id: 'bad', state: {} });
  assert.equal(normalized, null);
});

test('buildReplayShareUrl creates id-based share links', async () => {
  const { buildReplayShareUrl } = await loadModule();
  const replay = buildReplay();
  const url = buildReplayShareUrl(replay, { origin: 'http://localhost:4000' });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('g'), replay.id);
  assert.equal(parsed.searchParams.get('r'), null);
  assert.equal(parsed.hash, '');
});

test('buildReplayShareUrl supports replay id strings', async () => {
  const { buildReplayShareUrl } = await loadModule();
  const url = buildReplayShareUrl('history-42', { origin: 'http://localhost:4000' });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('g'), 'history-42');
});

test('parseReplayLinkParams reads primary and legacy query keys', async () => {
  const { parseReplayLinkParams } = await loadModule();
  const primary = parseReplayLinkParams('?g=history-1');
  assert.equal(primary.replayId, 'history-1');
  assert.equal(primary.replay, null);

  const legacyR = parseReplayLinkParams('?r=legacy-2');
  assert.equal(legacyR.replayId, 'legacy-2');

  const legacyReplay = parseReplayLinkParams('?replay=legacy-3');
  assert.equal(legacyReplay.replayId, 'legacy-3');
});

