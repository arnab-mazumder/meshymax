import test from 'node:test';
import assert from 'node:assert/strict';
import { isMeshyModelUrl, extractTaskId, NetworkMonitor } from '../backend/network-monitor.js';

test('network monitor - matches valid meshy model URLs', () => {
  const validUrl1 = 'https://assets.meshy.ai/user_123/tasks/abc123def/output/model.meshy?token=xyz';
  const validUrl2 = 'https://assets.meshy.ai/org/team/tasks/task-999-xyz/output/model.meshy';

  assert.equal(isMeshyModelUrl(validUrl1), true);
  assert.equal(isMeshyModelUrl(validUrl2), true);
});

test('network monitor - rejects non-matching URLs', () => {
  const invalidUrl1 = 'https://meshy.ai/workspace';
  const invalidUrl2 = 'https://assets.meshy.ai/user_123/tasks/abc123def/output/preview.png';
  const invalidUrl3 = 'https://malicious.com/tasks/abc123def/output/model.meshy';
  const invalidUrl4 = 'http://assets.meshy.ai/tasks/abc123/output/model.meshy';

  assert.equal(isMeshyModelUrl(invalidUrl1), false);
  assert.equal(isMeshyModelUrl(invalidUrl2), false);
  assert.equal(isMeshyModelUrl(invalidUrl3), false);
  assert.equal(isMeshyModelUrl(invalidUrl4), false);
});

test('network monitor - extracts task ID correctly', () => {
  const url1 = 'https://assets.meshy.ai/v1/users/usr_1/tasks/task_abc123/output/model.meshy?Expires=17000000';
  const url2 = 'https://assets.meshy.ai/tasks/7af812-999-xyz/output/model.meshy';

  assert.equal(extractTaskId(url1), 'task_abc123');
  assert.equal(extractTaskId(url2), '7af812-999-xyz');
});

test('network monitor - task processed state tracking', () => {
  const monitor = new NetworkMonitor();

  assert.equal(monitor.isProcessed('task_1'), false);
  monitor.markProcessed('task_1');
  assert.equal(monitor.isProcessed('task_1'), true);

  monitor.clearProcessed();
  assert.equal(monitor.isProcessed('task_1'), false);
});
