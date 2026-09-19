import test from 'node:test';
import assert from 'node:assert/strict';
import { convertMeshy, isMeshyFile, isGlbFile } from '../src/converter.js';

test('converter - recognizes invalid file format', async () => {
  const invalidBuffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(isGlbFile(invalidBuffer.buffer), false);
  assert.equal(isMeshyFile(invalidBuffer.buffer), false);
  await assert.rejects(
    async () => { await convertMeshy(invalidBuffer); },
    { message: /Invalid input file format/ }
  );
});

test('converter - passes through standard GLB buffer', async () => {
  // Construct minimal GLB header (magic: 'glTF', version: 2, length: 28)
  const glbHeader = new Uint8Array([
    0x67, 0x6c, 0x54, 0x46, // magic: 'glTF'
    0x02, 0x00, 0x00, 0x00, // version: 2
    0x1c, 0x00, 0x00, 0x00, // length: 28
    0x08, 0x00, 0x00, 0x00, // chunk length: 8
    0x4e, 0x4f, 0x53, 0x4a, // chunk type: JSON
    0x7b, 0x7d, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20 // chunk data: {}
  ]);

  assert.equal(isGlbFile(glbHeader.buffer), true);
  const result = await convertMeshy(glbHeader.buffer);
  assert.ok(result instanceof Buffer || result instanceof Uint8Array);
  assert.equal(result.byteLength >= 28, true);
  assert.equal(result[0], 0x67);
  assert.equal(result[1], 0x6c);
  assert.equal(result[2], 0x54);
  assert.equal(result[3], 0x46);
});

test('converter service - processes conversion using worker thread', async () => {
  const { ConverterService } = await import('../backend/converter-service.js');
  const service = new ConverterService();
  await service.init();

  const glbHeader = new Uint8Array([
    0x67, 0x6c, 0x54, 0x46,
    0x02, 0x00, 0x00, 0x00,
    0x1c, 0x00, 0x00, 0x00,
    0x08, 0x00, 0x00, 0x00,
    0x4e, 0x4f, 0x53, 0x4a,
    0x7b, 0x7d, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20
  ]);

  const converted = await service.processConversion('test_worker_task', glbHeader.buffer, 'auto');
  assert.ok(converted instanceof Buffer || converted instanceof Uint8Array);
  assert.equal(converted[0], 0x67);

  const stored = service.getConvertedBuffer('test_worker_task');
  assert.ok(stored);
  assert.equal(stored.length, converted.length);

  service.removeTask('test_worker_task');
  assert.equal(service.getConvertedBuffer('test_worker_task'), null);
});

