const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createLobbyStore } = require('../dist/state/lobby.js');

test('lobby store manages queues and emits updates', async () => {
  const lobby = createLobbyStore();
  const firstEvent = once(lobby.events, 'queueChanged');

  lobby.addToQueue('user-1', 'quickplay1v1Queue');

  const [snapshot] = await firstEvent;
  assert.deepEqual(snapshot.quickplay1v1Queue, ['user-1']);

  lobby.addToQueue('user-1', 'rankedQueue');
  let current = lobby.serialize();
  assert.deepEqual(current.quickplay1v1Queue, []);
  assert.deepEqual(current.rankedQueue, ['user-1']);

  lobby.addToQueue('user-2', 'rankedQueue');
  lobby.addToQueue('user-2', 'rankedQueue');
  current = lobby.serialize();
  assert.deepEqual(current.rankedQueue, ['user-1', 'user-2']);

  lobby.markInGame(['user-1']);
  current = lobby.serialize();
  assert.deepEqual(current.rankedQueue, ['user-2']);
  assert.deepEqual(current.inGame, ['user-1']);

  lobby.removeFromQueue('user-1');
  current = lobby.serialize();
  assert.deepEqual(current.inGame, []);
});
