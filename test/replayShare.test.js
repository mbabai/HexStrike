const { test } = require('node:test');
const assert = require('node:assert/strict');

const loadModule = async () => import('../public/replayShare.mjs');

const buildReplay = () => ({
  id: 'replay-1',
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
      beats: [[{ username: 'Alice', action: 'E', rotation: '0', priority: 1, damage: 0, location: { q: 0, r: 0 }, facing: 0, calculated: true }]],
      timeline: [],
      characters: [],
      customInteractions: [],
      matchOutcome: {
        winnerUserId: 'u1',
        loserUserId: 'u2',
        reason: 'forfeit',
        beatIndex: 0,
      },
    },
  },
});

test('encodeReplayPayload and decodeReplayPayload round-trip replay state', async () => {
  const { encodeReplayPayload, decodeReplayPayload } = await loadModule();
  const replay = buildReplay();
  const encoded = encodeReplayPayload(replay);
  assert.ok(typeof encoded === 'string' && encoded.length > 0);
  const decoded = decodeReplayPayload(encoded);
  assert.equal(decoded?.id, replay.id);
  assert.equal(decoded?.players?.length, 2);
  assert.equal(decoded?.state?.public?.matchOutcome?.reason, 'forfeit');
});

test('buildReplayShareUrl includes replay id and encoded replay payload in hash', async () => {
  const { buildReplayShareUrl } = await loadModule();
  const replay = buildReplay();
  const url = buildReplayShareUrl(replay, { origin: 'http://localhost:4000' });
  assert.ok(url.includes('/?'));
  assert.ok(url.includes('replay=replay-1'));
  assert.ok(url.includes('#rp='));
});

test('parseReplayLinkParams recovers replay from query and hash', async () => {
  const { buildReplayShareUrl, parseReplayLinkParams } = await loadModule();
  const replay = buildReplay();
  const url = buildReplayShareUrl(replay, { origin: 'http://localhost:4000' });
  const parsedUrl = new URL(url);
  const parsed = parseReplayLinkParams(parsedUrl.search, parsedUrl.hash);
  assert.equal(parsed.replayId, 'replay-1');
  assert.equal(parsed.replay?.state?.public?.matchOutcome?.reason, 'forfeit');
});

test('parseReplayLinkParams supports legacy query payload links', async () => {
  const { encodeReplayPayload, parseReplayLinkParams } = await loadModule();
  const replay = buildReplay();
  const encoded = encodeReplayPayload(replay);
  const parsed = parseReplayLinkParams(`?replay=replay-1&rp=${encodeURIComponent(encoded)}`, '');
  assert.equal(parsed.replayId, 'replay-1');
  assert.equal(parsed.replay?.state?.public?.matchOutcome?.reason, 'forfeit');
});
