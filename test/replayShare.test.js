const { test } = require('node:test');
const assert = require('node:assert/strict');

const loadModule = async () => import('../public/replayShare.mjs');

const toBase64Url = (value) => value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const encodeLegacyReplayPayload = (replay) =>
  toBase64Url(Buffer.from(JSON.stringify({ version: 1, replay }), 'utf8').toString('base64'));

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

const buildLargeReplay = () => {
  const replay = buildReplay();
  const beats = [];
  for (let beat = 0; beat < 60; beat += 1) {
    beats.push([
      {
        username: 'Alice',
        action: beat % 4 === 0 ? '[a-La-Ra]' : beat % 3 === 0 ? 'DamageIcon' : beat % 2 === 0 ? 'B2m' : 'E',
        rotation: `${beat % 6}`,
        rotationSource: beat % 2 === 0 ? 'selected' : 'forced',
        priority: 1,
        damage: beat,
        attackDamage: 6,
        attackKbf: 2,
        location: { q: beat % 5, r: -(beat % 4) },
        facing: beat % 6,
        calculated: true,
      },
      {
        username: 'Bob',
        action: beat % 5 === 0 ? 'knockbackIcon' : beat % 2 === 0 ? 'a' : 'E',
        rotation: `${(beat + 3) % 6}`,
        priority: 2,
        damage: beat + 1,
        attackDamage: 5,
        attackKbf: 1,
        location: { q: -(beat % 6), r: beat % 3 },
        facing: (beat + 2) % 6,
        calculated: true,
      },
    ]);
  }
  replay.state.public.beats = beats;
  replay.state.public.timeline = beats;
  return replay;
};

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

test('buildReplayShareUrl defaults to short replay-id links', async () => {
  const { buildReplayShareUrl } = await loadModule();
  const replay = buildReplay();
  const url = buildReplayShareUrl(replay, { origin: 'http://localhost:4000' });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('r'), 'replay-1');
  assert.equal(parsed.hash, '');
});

test('buildReplayShareUrl includes compressed payload when requested', async () => {
  const { buildReplayShareUrl } = await loadModule();
  const replay = buildReplay();
  const url = buildReplayShareUrl(replay, { origin: 'http://localhost:4000', includePayload: true });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('r'), 'replay-1');
  assert.ok(parsed.hash.startsWith('#z.'));
});

test('parseReplayLinkParams recovers replay from query and hash', async () => {
  const { buildReplayShareUrl, parseReplayLinkParams } = await loadModule();
  const replay = buildReplay();
  const url = buildReplayShareUrl(replay, { origin: 'http://localhost:4000', includePayload: true });
  const parsedUrl = new URL(url);
  const parsed = parseReplayLinkParams(parsedUrl.search, parsedUrl.hash);
  assert.equal(parsed.replayId, 'replay-1');
  assert.equal(parsed.replay?.state?.public?.matchOutcome?.reason, 'forfeit');
});

test('parseReplayLinkParams supports legacy query payload links', async () => {
  const { normalizeReplayPayload, parseReplayLinkParams } = await loadModule();
  const replay = buildReplay();
  const encoded = encodeLegacyReplayPayload(normalizeReplayPayload(replay));
  const parsed = parseReplayLinkParams(`?replay=replay-1&rp=${encodeURIComponent(encoded)}`, '');
  assert.equal(parsed.replayId, 'replay-1');
  assert.equal(parsed.replay?.state?.public?.matchOutcome?.reason, 'forfeit');
});

test('compressed encoding is shorter than legacy encoding for large timelines', async () => {
  const { encodeReplayPayload, normalizeReplayPayload } = await loadModule();
  const replay = buildLargeReplay();
  const compressed = encodeReplayPayload(replay);
  const legacy = encodeLegacyReplayPayload(normalizeReplayPayload(replay));
  assert.ok(typeof compressed === 'string' && compressed.length > 0);
  assert.ok(compressed.length < legacy.length);
});
