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

test('selectPendingInteraction returns pending draw even if beat is resolved', async () => {
  const { selectPendingInteraction } = await loadModule();
  const interactions = [
    { id: 'draw:0:me:me', type: 'draw', status: 'pending', actorUserId: 'me', targetUserId: 'me', beatIndex: 0 },
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

  assert.equal(pending?.id, 'draw:0:me:me');
});

test('selectPendingInteraction returns pending guard continue even if beat is resolved', async () => {
  const { selectPendingInteraction } = await loadModule();
  const interactions = [
    {
      id: 'guard-continue:0:me:me',
      type: 'guard-continue',
      status: 'pending',
      actorUserId: 'me',
      targetUserId: 'me',
      beatIndex: 0,
    },
  ];
  const beats = [[{ username: 'me', action: '[b-Lb-Rb]' }]];
  const characters = [{ userId: 'me', username: 'me' }];
  const pending = selectPendingInteraction({
    interactions,
    beats,
    characters,
    localUserId: 'me',
    resolvedIndex: 0,
  });

  assert.equal(pending?.id, 'guard-continue:0:me:me');
});

test('selectPendingInteraction returns pending rewind return even if beat is resolved', async () => {
  const { selectPendingInteraction } = await loadModule();
  const interactions = [
    {
      id: 'rewind-return:0:me:me',
      type: 'rewind-return',
      status: 'pending',
      actorUserId: 'me',
      targetUserId: 'me',
      beatIndex: 0,
    },
  ];
  const beats = [[{ username: 'me', action: 'E' }]];
  const characters = [{ userId: 'me', username: 'me' }];
  const pending = selectPendingInteraction({
    interactions,
    beats,
    characters,
    localUserId: 'me',
    resolvedIndex: 0,
  });

  assert.equal(pending?.id, 'rewind-return:0:me:me');
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

test('selectPendingInteraction gates hand-trigger prompts by global order', async () => {
  const { selectPendingInteraction } = await loadModule();
  const interactions = [
    { id: 'hand-trigger:a', type: 'hand-trigger', status: 'pending', actorUserId: 'me', beatIndex: 1, handTriggerOrder: 2 },
    { id: 'hand-trigger:b', type: 'hand-trigger', status: 'pending', actorUserId: 'you', beatIndex: 1, handTriggerOrder: 1 },
  ];
  const beats = [[{ username: 'me', action: 'W' }, { username: 'you', action: 'W' }]];
  const characters = [{ userId: 'me', username: 'me' }, { userId: 'you', username: 'you' }];
  const pending = selectPendingInteraction({
    interactions,
    beats,
    characters,
    localUserId: 'me',
    resolvedIndex: -1,
  });

  assert.equal(pending, null);
});

test('selectPendingInteraction accepts discard interactions targeting the local player', async () => {
  const { selectPendingInteraction } = await loadModule();
  const interactions = [
    { id: 'discard:1:other:other', type: 'discard', status: 'pending', actorUserId: 'other', targetUserId: 'me', beatIndex: 1 },
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

  assert.equal(pending?.id, 'discard:1:other:other');
});
