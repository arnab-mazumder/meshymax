import test from 'node:test';
import assert from 'node:assert/strict';
import { startFreshMeshySession } from '../backend/fresh-session.js';

test('fresh-session module - exports startFreshMeshySession function', () => {
  assert.equal(typeof startFreshMeshySession, 'function');
});

test('fresh-session module - rejects on invalid configuration', async () => {
  await assert.rejects(
    () => startFreshMeshySession({ timeout: 0 }),
    { message: /Invalid timeout/ }
  );
});
