import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_PATH = path.join(__dirname, 'converter-worker.js');

// Auto-expire converted files from RAM after 5 minutes
const BUFFER_TTL_MS = 5 * 60 * 1000;

export class ConverterService {
  constructor(options = {}) {
    this.history = [];
    this.activeTasks = new Map(); // taskId -> task state object
    this.convertedFiles = new Map(); // taskId -> { buffer, timer }
    this.onTaskStateChange = options.onTaskStateChange || null;
    this.tempBaseDir = path.join(os.tmpdir(), 'meshy-auto-converter');
  }

  async init() {
    try {
      await fs.mkdir(this.tempBaseDir, { recursive: true });
    } catch (err) {
      console.error('[ConverterService] Error creating temp dir:', err);
    }
  }

  getHistory() {
    return this.history;
  }

  getTaskStatus(taskId) {
    return this.activeTasks.get(taskId) || null;
  }

  getConvertedBuffer(taskId) {
    const entry = this.convertedFiles.get(taskId);
    return entry ? entry.buffer : null;
  }

  removeTask(taskId) {
    this.activeTasks.delete(taskId);
    const entry = this.convertedFiles.get(taskId);
    if (entry) {
      clearTimeout(entry.timer);
      this.convertedFiles.delete(taskId);
    }
    this.history = this.history.filter(t => t.taskId !== taskId);
    this._emitStateChange({ type: 'task_removed', taskId });
  }

  clearHistory() {
    this.history = [];
    for (const [, entry] of this.convertedFiles) {
      clearTimeout(entry.timer);
    }
    this.convertedFiles.clear();
    this.activeTasks.clear();
    this._emitStateChange({ type: 'history_cleared' });
  }

  _emitStateChange(event) {
    if (this.onTaskStateChange) {
      this.onTaskStateChange(event);
    }
  }

  _storeBuffer(taskId, buffer) {
    // Clear previous timer if re-storing
    const prev = this.convertedFiles.get(taskId);
    if (prev) clearTimeout(prev.timer);

    const timer = setTimeout(() => {
      this.convertedFiles.delete(taskId);
      console.log(`[ConverterService] Expired buffer for ${taskId} (TTL)`);
    }, BUFFER_TTL_MS);

    this.convertedFiles.set(taskId, { buffer, timer });
  }

  /**
   * Convert in a worker thread to keep main event loop free.
   * Falls back to main-thread conversion if worker fails to spawn.
   */
  _runWorker(rawBuffer) {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker(WORKER_PATH, {
          workerData: { buffer: Buffer.from(rawBuffer) }
        });

        worker.on('message', (msg) => {
          if (msg.success) {
            resolve(Buffer.from(msg.buffer));
          } else {
            reject(new Error(msg.error));
          }
        });

        worker.on('error', (err) => reject(err));
        worker.on('exit', (code) => {
          if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Processes binary meshy data and converts to GLB.
   * 
   * @param {string} taskId 
   * @param {Buffer | ArrayBuffer} rawBuffer 
   * @param {string} source - 'auto' | 'manual_file' | 'manual_url'
   * @returns {Promise<Buffer>}
   */
  async processConversion(taskId, rawBuffer, source = 'auto') {
    const filename = `${taskId}.glb`;
    const taskState = {
      taskId,
      filename,
      source,
      status: 'Queued',
      progress: 10,
      timestamp: new Date().toISOString(),
      sizeBytes: rawBuffer.byteLength || rawBuffer.length,
      error: null
    };

    this.activeTasks.set(taskId, taskState);
    this._emitStateChange({ type: 'conversion_started', task: { ...taskState } });

    try {
      // Step 1: Converting (worker thread)
      taskState.status = 'Converting';
      taskState.progress = 40;
      this._emitStateChange({ type: 'conversion_progress', task: { ...taskState } });

      let glbBuffer;
      try {
        glbBuffer = await this._runWorker(rawBuffer);
      } catch (workerErr) {
        // Fallback: main-thread conversion
        console.warn(`[ConverterService] Worker failed (${workerErr.message}), falling back to main thread`);
        const { convertMeshy } = await import('../src/converter.js');
        glbBuffer = await convertMeshy(rawBuffer);
      }

      // Release input buffer reference
      rawBuffer = null;

      // Store with TTL
      this._storeBuffer(taskId, glbBuffer);

      // Finalize
      taskState.status = 'Completed';
      taskState.progress = 100;
      taskState.sizeBytes = glbBuffer.length;

      const historyItem = { ...taskState };
      const existingIdx = this.history.findIndex(h => h.taskId === taskId);
      if (existingIdx >= 0) {
        this.history[existingIdx] = historyItem;
      } else {
        this.history.unshift(historyItem);
      }

      this._emitStateChange({ type: 'conversion_completed', task: historyItem, filename });

      return glbBuffer;

    } catch (err) {
      console.error(`[ConverterService] Conversion failed for task ${taskId}:`, err);
      taskState.status = 'Failed';
      taskState.error = err.message || 'Conversion failed';
      taskState.progress = 0;

      const historyItem = { ...taskState };
      const existingIdx = this.history.findIndex(h => h.taskId === taskId);
      if (existingIdx >= 0) {
        this.history[existingIdx] = historyItem;
      } else {
        this.history.unshift(historyItem);
      }

      this._emitStateChange({ type: 'conversion_failed', taskId, error: taskState.error, task: historyItem });
      throw err;
    }
  }
}
