const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

process.env.NODE_ENV = 'production';
process.env.HEXSTRIKE_REQUIRE_MONGO_HISTORY = '0';
process.env.MONGODB_URI = '';
process.env.MONGODB_PROD_URI = '';

const { buildServer } = require('../dist/server.js');
const {
  getCharactersAtEarliestE,
  getTimelineEarliestEIndex,
} = require('../dist/game/beatTimeline.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeDegrees = (value) => {
  const normalized = ((value % 360) + 360) % 360;
  return Number.isFinite(normalized) ? normalized : 0;
};

const rotateAxialCW = (coord) => ({ q: -coord.r, r: coord.q + coord.r });

const rotateAxial = (coord, steps) => {
  let rotated = { ...coord };
  const normalized = ((steps % 6) + 6) % 6;
  for (let i = 0; i < normalized; i += 1) {
    rotated = rotateAxialCW(rotated);
  }
  return rotated;
};

const getFacingRotationSteps = (facing) => {
  const steps = Math.round((normalizeDegrees(facing) - 180) / 60);
  return ((steps % 6) + 6) % 6;
};

const applyFacingToVector = (vector, facing) => rotateAxial(vector, getFacingRotationSteps(facing));

const AXIAL_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

const getDirectionIndex = (delta) => {
  for (let i = 0; i < AXIAL_DIRECTIONS.length; i += 1) {
    const dir = AXIAL_DIRECTIONS[i];
    if (dir.q === 0 && delta.q !== 0) continue;
    if (dir.r === 0 && delta.r !== 0) continue;
    if (dir.q !== 0) {
      const scale = delta.q / dir.q;
      if (Number.isFinite(scale) && scale > 0 && Math.round(scale) === scale && dir.r * scale === delta.r) return i;
      continue;
    }
    if (dir.r !== 0) {
      const scale = delta.r / dir.r;
      if (Number.isFinite(scale) && scale > 0 && Math.round(scale) === scale && dir.q * scale === delta.q) return i;
    }
  }
  return null;
};

const getBehindDirection = (facing) => getDirectionIndex(applyFacingToVector({ q: -1, r: 0 }, facing));

const buildJsonClient = (baseUrl) => {
  const request = async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, options);
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  };

  const post = (path, body) =>
    request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });

  const get = (path) => request(path, { method: 'GET' });

  return { get, post };
};

const findCharacterEntry = (beat, character) =>
  (beat ?? []).find((entry) => {
    const key = entry?.userId ?? entry?.username ?? entry?.userID;
    return key === character.userId || key === character.username;
  }) ?? null;

const hasActionStarter = (snapshot, userId, cardId, passiveCardId = null) => {
  const characters = snapshot?.state?.public?.characters ?? [];
  const beats = snapshot?.state?.public?.beats ?? [];
  const character = characters.find((candidate) => candidate.userId === userId);
  if (!character) return false;
  for (let i = 0; i < beats.length; i += 1) {
    const entry = findCharacterEntry(beats[i], character);
    if (!entry) continue;
    if (entry.rotationSource !== 'selected') continue;
    if (`${entry.cardId ?? ''}` !== `${cardId}`) continue;
    if (passiveCardId && `${entry.passiveCardId ?? ''}` !== `${passiveCardId}`) continue;
    return true;
  }
  return false;
};

const getPendingInteractionForUser = (snapshot, userId, type = null) => {
  const interactions = snapshot?.state?.public?.customInteractions ?? [];
  return (
    interactions.find(
      (interaction) =>
        interaction?.status === 'pending' &&
        interaction?.actorUserId === userId &&
        (type ? interaction?.type === type : true),
    ) ?? null
  );
};

const isUserAtBat = (snapshot, userId) => {
  const beats = snapshot?.state?.public?.beats ?? [];
  const characters = snapshot?.state?.public?.characters ?? [];
  if (!beats.length || !characters.length) return false;
  const earliest = getTimelineEarliestEIndex(beats, characters);
  const atBat = getCharactersAtEarliestE(beats, characters);
  if (!Number.isFinite(earliest)) return false;
  return atBat.some((character) => character.userId === userId);
};

const waitFor = async (getSnapshot, predicate, options = {}) => {
  const timeoutMs = options.timeoutMs ?? 10000;
  const intervalMs = options.intervalMs ?? 75;
  const start = Date.now();
  let latest = null;
  while (Date.now() - start < timeoutMs) {
    latest = await getSnapshot();
    if (predicate(latest)) return latest;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`);
};

const resolveThrowBehindDirection = (snapshot, interaction, userId) => {
  if (!interaction || interaction.type !== 'throw') return null;
  const characters = snapshot?.state?.public?.characters ?? [];
  const beats = snapshot?.state?.public?.beats ?? [];
  const actor = characters.find((candidate) => candidate.userId === userId);
  if (!actor) return null;
  const beatIndex = Number.isFinite(interaction.beatIndex) ? Math.max(0, Math.round(interaction.beatIndex)) : 0;
  let facing = Number.isFinite(actor.facing) ? actor.facing : null;
  for (let i = Math.min(beatIndex, beats.length - 1); i >= 0; i -= 1) {
    const entry = findCharacterEntry(beats[i], actor);
    if (entry && Number.isFinite(entry.facing)) {
      facing = entry.facing;
      break;
    }
  }
  if (!Number.isFinite(facing)) return null;
  return getBehindDirection(facing);
};

test('tutorial queue uses scripted flow, forced loadout, and strict tutorial choices', async () => {
  const server = buildServer(0);
  await once(server, 'listening');
  const port = server.address().port;
  const client = buildJsonClient(`http://127.0.0.1:${port}`);

  try {
    const playerUserId = `tutorial-player-${Date.now()}`;
    const join = await client.post('/api/v1/lobby/join', {
      userId: playerUserId,
      username: 'Tutorial Tester',
      queue: 'tutorialQueue',
      deck: { movement: [], ability: [] },
    });
    assert.equal(join.response.status, 200);

    const matchList = await waitFor(
      async () => {
        const { response, payload } = await client.get('/api/v1/history/matches');
        assert.equal(response.status, 200);
        return payload;
      },
      (matches) => Array.isArray(matches) && matches.some((match) => match.players?.some((player) => player.userId === playerUserId)),
      { timeoutMs: 12000 },
    );

    const match = matchList.find((candidate) =>
      Array.isArray(candidate.players) && candidate.players.some((player) => player.userId === playerUserId),
    );
    assert.ok(match, 'expected tutorial match');
    assert.ok(match.gameId, 'expected tutorial game id');
    const gameId = `${match.gameId}`;
    const botPlayer = match.players.find((player) => player.userId !== playerUserId);
    assert.ok(botPlayer, 'expected tutorial opponent');
    const botUserId = botPlayer.userId;

    const getSnapshot = async () => {
      const { response, payload } = await client.get(`/api/v1/game/${gameId}/snapshot`);
      assert.equal(response.status, 200);
      return payload;
    };

    const initialSnapshot = await waitFor(
      getSnapshot,
      (snapshot) => {
        const publicState = snapshot?.state?.public;
        return Array.isArray(publicState?.characters) && publicState.characters.length === 2;
      },
      { timeoutMs: 12000 },
    );
    assert.equal(initialSnapshot.state.public.tutorial?.enabled, true);
    const playerCharacter = initialSnapshot.state.public.characters.find((character) => character.userId === playerUserId);
    const botCharacter = initialSnapshot.state.public.characters.find((character) => character.userId === botUserId);
    assert.equal(playerCharacter?.characterId, 'monkey-queen');
    assert.equal(botCharacter?.characterId, 'strylan');

    const wrongOpen = await client.post('/api/v1/game/action-set', {
      userId: playerUserId,
      gameId,
      activeCardId: 'advance',
      passiveCardId: 'fumikomi',
      rotation: '0',
    });
    assert.equal(wrongOpen.response.status, 409);
    assert.equal(wrongOpen.payload?.code, 'tutorial-step-mismatch');

    const submitAction = async ({ activeCardId, passiveCardId, rotation }) => {
      const { response, payload } = await client.post('/api/v1/game/action-set', {
        userId: playerUserId,
        gameId,
        activeCardId,
        passiveCardId,
        rotation,
      });
      assert.equal(response.status, 200, payload?.error ?? 'expected tutorial action to succeed');
    };

    const resolveInteraction = async (interactionId, body, expectedStatus = 200) => {
      const { response, payload } = await client.post('/api/v1/game/interaction', {
        userId: playerUserId,
        gameId,
        interactionId,
        ...body,
      });
      assert.equal(response.status, expectedStatus, payload?.error ?? 'unexpected interaction status');
      return payload;
    };

    await waitFor(
      getSnapshot,
      (snapshot) => isUserAtBat(snapshot, playerUserId) && !getPendingInteractionForUser(snapshot, playerUserId),
      { timeoutMs: 12000 },
    );
    await submitAction({ activeCardId: 'step', passiveCardId: 'fumikomi', rotation: '0' });

    await waitFor(
      getSnapshot,
      (snapshot) => hasActionStarter(snapshot, botUserId, 'fleche', 'long-thrust'),
      { timeoutMs: 12000 },
    );

    await waitFor(
      getSnapshot,
      (snapshot) => isUserAtBat(snapshot, playerUserId) && !getPendingInteractionForUser(snapshot, playerUserId),
      { timeoutMs: 12000 },
    );
    await submitAction({ activeCardId: 'jab', passiveCardId: 'fleche', rotation: '0' });

    const comboSnapshot = await waitFor(
      getSnapshot,
      (snapshot) => Boolean(getPendingInteractionForUser(snapshot, playerUserId, 'combo')),
      { timeoutMs: 12000 },
    );
    const comboInteraction = getPendingInteractionForUser(comboSnapshot, playerUserId, 'combo');
    assert.ok(comboInteraction, 'expected combo interaction');

    const wrongCombo = await client.post('/api/v1/game/interaction', {
      userId: playerUserId,
      gameId,
      interactionId: comboInteraction.id,
      continueCombo: false,
    });
    assert.equal(wrongCombo.response.status, 409);
    assert.equal(wrongCombo.payload?.code, 'tutorial-step-mismatch');

    await resolveInteraction(comboInteraction.id, { continueCombo: true }, 200);

    await waitFor(
      getSnapshot,
      (snapshot) => isUserAtBat(snapshot, playerUserId) && !getPendingInteractionForUser(snapshot, playerUserId),
      { timeoutMs: 12000 },
    );
    await submitAction({ activeCardId: 'cross-slash', passiveCardId: 'step', rotation: '0' });

    await waitFor(
      getSnapshot,
      (snapshot) => hasActionStarter(snapshot, botUserId, 'guard', 'step'),
      { timeoutMs: 12000 },
    );

    await waitFor(
      getSnapshot,
      (snapshot) => isUserAtBat(snapshot, playerUserId) && !getPendingInteractionForUser(snapshot, playerUserId),
      { timeoutMs: 12000 },
    );
    await submitAction({ activeCardId: 'step', passiveCardId: 'guard', rotation: 'R1' });

    await waitFor(
      getSnapshot,
      (snapshot) => hasActionStarter(snapshot, botUserId, 'advance', 'sinking-shot'),
      { timeoutMs: 12000 },
    );

    await waitFor(
      getSnapshot,
      (snapshot) => isUserAtBat(snapshot, playerUserId) && !getPendingInteractionForUser(snapshot, playerUserId),
      { timeoutMs: 12000 },
    );
    await submitAction({ activeCardId: 'hip-throw', passiveCardId: 'step', rotation: '3' });

    const postHipThrowSnapshot = await waitFor(
      getSnapshot,
      (snapshot) =>
        Boolean(getPendingInteractionForUser(snapshot, playerUserId, 'throw')) ||
        hasActionStarter(snapshot, botUserId, 'fleche', 'jab'),
      { timeoutMs: 12000 },
    );
    const throwInteraction = getPendingInteractionForUser(postHipThrowSnapshot, playerUserId, 'throw');
    if (throwInteraction) {
      const expectedBehindDirection = resolveThrowBehindDirection(postHipThrowSnapshot, throwInteraction, playerUserId);
      assert.notEqual(expectedBehindDirection, null, 'expected deterministic behind throw direction');

      const wrongDirection = (expectedBehindDirection + 1) % 6;
      const wrongThrow = await client.post('/api/v1/game/interaction', {
        userId: playerUserId,
        gameId,
        interactionId: throwInteraction.id,
        directionIndex: wrongDirection,
      });
      assert.equal(wrongThrow.response.status, 409);
      assert.equal(wrongThrow.payload?.code, 'tutorial-step-mismatch');

      await resolveInteraction(throwInteraction.id, { directionIndex: expectedBehindDirection }, 200);
    }

    await waitFor(
      getSnapshot,
      (snapshot) => isUserAtBat(snapshot, playerUserId) && !getPendingInteractionForUser(snapshot, playerUserId),
      { timeoutMs: 12000 },
    );
    await submitAction({ activeCardId: 'feint', passiveCardId: 'step', rotation: '0' });

    await waitFor(
      getSnapshot,
      (snapshot) => hasActionStarter(snapshot, botUserId, 'parry', 'step'),
      { timeoutMs: 12000 },
    );

    await waitFor(
      getSnapshot,
      (snapshot) => isUserAtBat(snapshot, playerUserId) && !getPendingInteractionForUser(snapshot, playerUserId),
      { timeoutMs: 12000 },
    );
    await submitAction({ activeCardId: 'smash-attack', passiveCardId: 'advance', rotation: '3' });

    const postFinishSnapshot = await getSnapshot();
    assert.ok(postFinishSnapshot?.state?.public, 'expected game state after tutorial finish submission');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
