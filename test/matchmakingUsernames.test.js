const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assignMatchUsernames } = require('../dist/matchmaking/usernames.js');

test('assignMatchUsernames leaves unique names unchanged', () => {
  const result = assignMatchUsernames([
    { id: 'a', username: 'alice' },
    { id: 'b', username: 'bob' },
  ]);
  assert.deepEqual(result, ['alice', 'bob']);
});

test('assignMatchUsernames appends 1 and 2 for duplicate pair', () => {
  const result = assignMatchUsernames([
    { id: 'a', username: 'anonymous' },
    { id: 'b', username: 'anonymous' },
  ]);
  assert.deepEqual(result, ['anonymous1', 'anonymous2']);
});

test('assignMatchUsernames appends incremental suffixes for repeated names', () => {
  const result = assignMatchUsernames([
    { id: 'a', username: 'same' },
    { id: 'b', username: 'other' },
    { id: 'c', username: 'same' },
    { id: 'd', username: 'same' },
  ]);
  assert.deepEqual(result, ['same1', 'other', 'same2', 'same3']);
});
