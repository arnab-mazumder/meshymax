/**
 * Network Monitor for Meshy Auto-Converter.
 * Intercepts network responses matching Meshy 3D model asset URLs,
 * extracts task IDs, captures response binary bodies, and enforces duplicate prevention.
 */

export const MESHY_MODEL_REGEX = /^https:\/\/assets\.meshy\.ai\/.+\/tasks\/.+\/output\/model\.meshy(?:\?.*)?$/;
export const TASK_ID_REGEX = /\/tasks\/([^/]+)\/output\/model\.meshy/;

/**
 * Validates if a URL matches the target model.meshy endpoint.
 * @param {string} url 
 * @returns {boolean}
 */
export function isMeshyModelUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return MESHY_MODEL_REGEX.test(url);
}

/**
 * Extracts Task ID from a model.meshy asset URL.
 * @param {string} url 
 * @returns {string | null}
 */
export function extractTaskId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(TASK_ID_REGEX);
  return match ? match[1] : null;
}

export class NetworkMonitor {
  constructor(options = {}) {
    this.processedTasks = new Set();
    this.autoConvertEnabled = options.autoConvertEnabled ?? true;
    this.onModelDetected = options.onModelDetected || null;
    this.onNetworkLog = options.onNetworkLog || null;
    this.listeningPage = null;
  }

  setAutoConvert(enabled) {
    this.autoConvertEnabled = !!enabled;
  }

  isProcessed(taskId) {
    return this.processedTasks.has(taskId);
  }

  markProcessed(taskId) {
    this.processedTasks.add(taskId);
  }

  clearProcessed() {
    this.processedTasks.clear();
  }

  /**
   * Attaches response interceptor to Playwright page or context.
   * @param {import('playwright').Page} page 
   */
  attach(page) {
    this.listeningPage = page;

    page.on('response', async (response) => {
      try {
        const url = response.url();
        const status = response.status();

        // Safe network logging (metadata only - no sensitive headers or tokens)
        if (this.onNetworkLog) {
          const isMatch = isMeshyModelUrl(url);
          const safeUrl = url.split('?')[0]; // Strip query params with tokens
          this.onNetworkLog({
            timestamp: new Date().toISOString(),
            method: response.request().method(),
            url: safeUrl,
            status: status,
            isMatch: isMatch
          });
        }

        if (!isMeshyModelUrl(url)) {
          return;
        }

        if (status < 200 || status >= 300) {
          console.warn(`[NetworkMonitor] Matched model URL returned non-OK status: ${status}`);
          return;
        }

        const taskId = extractTaskId(url);
        if (!taskId) {
          console.warn(`[NetworkMonitor] Could not extract task ID from URL: ${url}`);
          return;
        }

        if (this.isProcessed(taskId)) {
          console.log(`[NetworkMonitor] Duplicate model task detected, ignoring: ${taskId}`);
          return;
        }

        if (!this.autoConvertEnabled) {
          console.log(`[NetworkMonitor] Model detected for task ${taskId}, but auto-conversion is OFF.`);
          return;
        }

        // Mark task as processed
        this.markProcessed(taskId);

        // Capture binary body directly from original response
        const buffer = await response.body();

        console.log(`[NetworkMonitor] Captured model.meshy response for task ${taskId} (${buffer.length} bytes)`);

        if (this.onModelDetected) {
          this.onModelDetected({
            taskId,
            url,
            buffer,
            sizeBytes: buffer.length
          });
        }
      } catch (err) {
        console.error('[NetworkMonitor] Error handling response event:', err);
      }
    });
  }
}
