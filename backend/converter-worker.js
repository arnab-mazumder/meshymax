/**
 * Worker thread for CPU-heavy .meshy → .glb conversion.
 * Runs AES-256-CTR decryption + meshopt WASM decompression off the main event loop.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { convertMeshy } from '../src/converter.js';

try {
  const inputBuffer = workerData.buffer;
  const glbBuffer = await convertMeshy(inputBuffer);
  parentPort.postMessage({ success: true, buffer: glbBuffer }, [glbBuffer.buffer]);
} catch (err) {
  parentPort.postMessage({ success: false, error: err.message });
}
