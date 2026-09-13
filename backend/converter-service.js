import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { convertMeshy } from '../src/converter.js';

export class ConverterService {
  constructor(options = {}) {
    this.history = [];
    this.activeTasks = new Map(); // taskId -> task state object
    this.convertedFiles = new Map(); // taskId -> Buffer
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
    return this.convertedFiles.get(taskId) || null;
  }

  removeTask(taskId) {
    this.activeTasks.delete(taskId);
    this.convertedFiles.delete(taskId);
    this.history = this.history.filter(t => t.taskId !== taskId);
    this._emitStateChange({ type: 'task_removed', taskId });
  }

  clearHistory() {
    this.history = [];
    this.convertedFiles.clear();
    this.activeTasks.clear();
    this._emitStateChange({ type: 'history_cleared' });
  }

  _emitStateChange(event) {
    if (this.onTaskStateChange) {
      this.onTaskStateChange(event);
    }
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

    const taskTempDir = path.join(this.tempBaseDir, taskId);

    try {
      // Step 1: Downloading / Preparing temp files
      taskState.status = 'Downloading';
      taskState.progress = 30;
      this._emitStateChange({ type: 'conversion_progress', task: { ...taskState } });

      await fs.mkdir(taskTempDir, { recursive: true });
      const rawFilePath = path.join(taskTempDir, `model.meshy`);
      await fs.writeFile(rawFilePath, Buffer.from(rawBuffer));

      // Step 2: Parsing & Converting
      taskState.status = 'Converting';
      taskState.progress = 60;
      this._emitStateChange({ type: 'conversion_progress', task: { ...taskState } });

      const glbBuffer = await convertMeshy(rawBuffer);

      // Step 3: Saving output GLB
      const glbFilePath = path.join(taskTempDir, filename);
      await fs.writeFile(glbFilePath, glbBuffer);

      // Store converted file buffer in memory map for API download
      this.convertedFiles.set(taskId, glbBuffer);

      // Finalizing
      taskState.status = 'Completed';
      taskState.progress = 100;
      taskState.sizeBytes = glbBuffer.length;

      // Add to history
      const historyItem = { ...taskState };
      const existingIdx = this.history.findIndex(h => h.taskId === taskId);
      if (existingIdx >= 0) {
        this.history[existingIdx] = historyItem;
      } else {
        this.history.unshift(historyItem);
      }

      this._emitStateChange({ type: 'conversion_completed', task: historyItem, filename });

      // Clean up temp folder asynchronously
      fs.rm(taskTempDir, { recursive: true, force: true }).catch(() => {});

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

      // Clean up temp folder
      fs.rm(taskTempDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  }
}
