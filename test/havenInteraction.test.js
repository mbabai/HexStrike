const { test } = require('node:test');
const assert = require('node:assert/strict');

const loadModule = async () => import('../public/game/havenInteraction.mjs');

test('getPendingHavenInteraction only returns haven-platform interactions', async () => {
  const { getPendingHavenInteraction } = await loadModule();

  const throwInteraction = { id: 'throw:0:me:you', type: 'throw' };
  const havenInteraction = { id: 'haven-platform:1:me:me', type: 'haven-platform' };

  assert.equal(getPendingHavenInteraction(throwInteraction), null);
  assert.equal(getPendingHavenInteraction(havenInteraction), havenInteraction);
});

test('getHavenTouchingHexes prefers interaction payload and deduplicates coords', async () => {
  const { getHavenTouchingHexes } = await loadModule();

  const pending = {
    type: 'haven-platform',
    touchingHexes: [
      { q: 0, r: 0 },
      { q: 0, r: 0 },
      { q: 1.2, r: -0.7 },
    ],
  };

  const touching = getHavenTouchingHexes(pending, []);

  assert.deepEqual(touching, [
    { q: 0, r: 0 },
    { q: 1, r: -1 },
  ]);
});

test('buildHavenHighlightState marks hovered touching hex', async () => {
  const { buildHavenHighlightState } = await loadModule();

  const pending = {
    type: 'haven-platform',
    touchingHexes: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
  };

  const state = buildHavenHighlightState({
    pending,
    sceneCharacters: [],
    interactionSubmitInFlight: false,
    hoverKey: '1,0',
    now: 360,
  });

  assert.ok(state);
  assert.deepEqual(state.touchingHexes, [{ q: 0, r: 0 }, { q: 1, r: 0 }]);
  assert.deepEqual(state.hoveredHex, { q: 1, r: 0 });
  assert.equal(typeof state.pulse, 'number');
});

test('resolveHavenTargetFromPointer resolves self-click and hover key', async () => {
  const { resolveHavenTargetFromPointer, getHavenHoverKeyFromPointer } = await loadModule();

  const pending = {
    type: 'haven-platform',
    actorUserId: 'me',
    touchingHexes: [{ q: 0, r: 0 }],
  };
  const sceneCharacters = [{ userId: 'me', username: 'me', position: { q: 0, r: 0 } }];
  const canvas = {
    clientWidth: 800,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  const viewState = {
    offset: { x: 0, y: 0 },
    scale: 1,
  };
  const options = {
    event: { clientX: 0, clientY: 0 },
    pending,
    sceneCharacters,
    localUserId: 'me',
    canvas,
    viewState,
    viewportWidth: 800,
    hexSizeFactor: 0.1,
  };

  const targetHex = resolveHavenTargetFromPointer(options);
  const hoverKey = getHavenHoverKeyFromPointer(options);

  assert.deepEqual(targetHex, { q: 0, r: 0 });
  assert.equal(hoverKey, '0,0');
});
