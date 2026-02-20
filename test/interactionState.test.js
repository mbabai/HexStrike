const { test } = require('node:test');
const assert = require('node:assert/strict');

let interactionStateModulePromise = null;

const loadInteractionStateModule = async () => {
  if (!interactionStateModulePromise) {
    interactionStateModulePromise = import('../public/game/interactionState.mjs');
  }
  return interactionStateModulePromise;
};

test('selectPendingInteraction matches local userId when interaction uses username actor id', async () => {
  const { selectPendingInteraction } = await loadInteractionStateModule();
  const characters = [
    { userId: 'u-alpha', username: 'alpha' },
    { userId: 'u-beta', username: 'beta' },
  ];
  const interactions = [
    {
      id: 'rewind-return:3:alpha:alpha',
      type: 'rewind-return',
      beatIndex: 3,
      actorUserId: 'alpha',
      targetUserId: 'alpha',
      status: 'pending',
    },
  ];

  const pending = selectPendingInteraction({
    interactions,
    beats: [],
    characters,
    localUserId: 'u-alpha',
    resolvedIndex: -1,
  });

  assert.ok(pending);
  assert.equal(pending.id, 'rewind-return:3:alpha:alpha');
});

test('selectPendingInteraction matches local username when interaction uses userId actor id', async () => {
  const { selectPendingInteraction } = await loadInteractionStateModule();
  const characters = [
    { userId: 'u-alpha', username: 'alpha' },
    { userId: 'u-beta', username: 'beta' },
  ];
  const interactions = [
    {
      id: 'rewind-return:4:u-alpha:u-alpha',
      type: 'rewind-return',
      beatIndex: 4,
      actorUserId: 'u-alpha',
      targetUserId: 'u-alpha',
      status: 'pending',
    },
  ];

  const pending = selectPendingInteraction({
    interactions,
    beats: [],
    characters,
    localUserId: 'alpha',
    resolvedIndex: -1,
  });

  assert.ok(pending);
  assert.equal(pending.id, 'rewind-return:4:u-alpha:u-alpha');
});
