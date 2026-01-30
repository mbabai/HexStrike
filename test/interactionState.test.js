const { test } = require('node:test');
const assert = require('node:assert/strict');

const loadModule = async () => import('../public/game/interactionState.mjs');

test('selectPendingInteraction returns pending throw even if beat is resolved', async () => {
  const { selectPendingInteraction } = await loadModule();
  const interactions = [
    { id: 'throw:0:me:you', type: 'throw', status: 'pending', actorUserId: 'me', targetUserId: 'you', beatIndex: 0 },
    { id: 'combo:0:me:me', type: 'combo', status: 'pending', actorUserId: 'me', beatIndex: 0 },
  ];
  const beats = [[{ username: 'me', action: 'W' }]];
  const characters = [{ userId: 'me', username: 'me' }];
  const pending = selectPendingInteraction({
    interactions,
    beats,
    characters,
    localUserId: 'me',
    resolvedIndex: 0,
  });

  assert.equal(pending?.id, 'throw:0:me:you');
});

test('selectPendingInteraction ignores combo without Co entry', async () => {
  const { selectPendingInteraction } = await loadModule();
  const interactions = [{ id: 'combo:0:me:me', type: 'combo', status: 'pending', actorUserId: 'me', beatIndex: 0 }];
  const beats = [[{ username: 'me', action: 'W' }]];
  const characters = [{ userId: 'me', username: 'me' }];
  const pending = selectPendingInteraction({
    interactions,
    beats,
    characters,
    localUserId: 'me',
    resolvedIndex: -1,
  });

  assert.equal(pending, null);
});

test('selectPendingInteraction returns combo when Co entry exists', async () => {
  const { selectPendingInteraction } = await loadModule();
  const interactions = [{ id: 'combo:1:me:me', type: 'combo', status: 'pending', actorUserId: 'me', beatIndex: 1 }];
  const beats = [
    [{ username: 'me', action: 'W' }],
    [{ username: 'me', action: 'Co' }],
  ];
  const characters = [{ userId: 'me', username: 'me' }];
  const pending = selectPendingInteraction({
    interactions,
    beats,
    characters,
    localUserId: 'me',
    resolvedIndex: -1,
  });

  assert.equal(pending?.id, 'combo:1:me:me');
});
