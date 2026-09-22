import { isMeshyFile, isGlbFile, meshyToGlb } from './decrypt.js';
import { decompressGlb } from './decompress.js';
import { MeshoptDecoder } from './meshopt_decoder.module.js';

/**
 * Converts a .meshy or .glb binary buffer into a standalone, uncompressed .glb ArrayBuffer.
 * 
 * @param {ArrayBuffer | Uint8Array} inputData - Input binary data of .meshy or .glb file.
 * @returns {Promise<ArrayBuffer>} - Standard GLB binary ArrayBuffer ready to be saved/downloaded.
 */
export async function convertMeshy(inputData) {
  if (!inputData) {
    throw new Error('No input data provided for conversion');
  }

  // Normalize input to ArrayBuffer
  let arrayBuffer;
  if (inputData instanceof ArrayBuffer) {
    arrayBuffer = inputData;
  } else if (ArrayBuffer.isView(inputData)) {
    arrayBuffer = inputData.buffer.slice(
      inputData.byteOffset,
      inputData.byteOffset + inputData.byteLength
    );
  } else {
    throw new Error('Unsupported data format. Expected ArrayBuffer or Uint8Array.');
  }

  const isGlb = isGlbFile(arrayBuffer);
  const isMeshy = isMeshyFile(arrayBuffer);

  if (!isGlb && !isMeshy) {
    throw new Error('Invalid input file format: Must be a valid .meshy or .glb file');
  }

  // Step 1: Decrypt AES-256-CTR .meshy container to intermediate GLB
  let intermediateGlb;
  if (isGlb) {
    intermediateGlb = arrayBuffer;
  } else {
    intermediateGlb = await meshyToGlb(arrayBuffer);
  }

  // Step 2: Decompress meshopt vertex/index bufferViews to standard raw vertex GLB
  const finalGlbBuffer = await decompressGlb(intermediateGlb, MeshoptDecoder);

  return finalGlbBuffer;
}

export { isMeshyFile, isGlbFile };
