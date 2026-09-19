/**
 * Network Monitor for Meshy Auto-Converter.
 * Intercepts network responses matching Meshy 3D model asset URLs,
 * extracts task IDs, captures response binary bodies, and enforces duplicate prevention.
 *
 * Performance: Uses raw CDP Network.responseReceived events to avoid
 * Playwright Response wrapper object creation for non-matching URLs.
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
    this.debugMode = options.debugMode ?? false;
    this.listeningPage = null;
    this._cdpSession = null;
    // Map requestId → url for CDP-based monitoring
    this._pendingRequests = new Map();
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
   * Preferred: Attach via raw CDP session for zero-overhead URL matching.
   * Only matching model.meshy URLs trigger any further processing.
   * @param {import('playwright').CDPSession} cdpSession
   * @param {import('playwright').Page} page - for fallback body fetching
   */
  async attachCDP(cdpSession, page) {
    this._cdpSession = cdpSession;
    this.listeningPage = page;

    await cdpSession.send('Network.enable');

    // Track responses: only store requestId when URL matches
    cdpSession.on('Network.responseReceived', (params) => {
      const url = params.response?.url;
      if (!url) return;

      // Ultra-cheap string check before regex
      if (!url.includes('/output/model.meshy')) return;
      if (!isMeshyModelUrl(url)) return;

      const status = params.response.status;
      if (status < 200 || status >= 300) return;

      // Store for loadingFinished
      this._pendingRequests.set(params.requestId, url);
    });

    // When the response body is fully received, grab it
    cdpSession.on('Network.loadingFinished', async (params) => {
      const url = this._pendingRequests.get(params.requestId);
      if (!url) return;
      this._pendingRequests.delete(params.requestId);

      await this._processMatchedResponse(url, params.requestId);
    });

    // Clean up failed requests
    cdpSession.on('Network.loadingFailed', (params) => {
      this._pendingRequests.delete(params.requestId);
    });

    if (this.debugMode) {
      console.log('[NetworkMonitor] Attached via CDP (zero-overhead mode)');
    }
  }

  /**
   * Fallback: Attach via Playwright page.on('response').
   * Only processes matching URLs — no logging of non-matching requests.
   * @param {import('playwright').Page} page 
   */
  attach(page) {
    this.listeningPage = page;

    page.on('response', async (response) => {
      try {
        const url = response.url();

        // Ultra-cheap bail-out for non-matching URLs
        if (!url.includes('/output/model.meshy')) return;
        if (!isMeshyModelUrl(url)) return;

        const status = response.status();
        if (status < 200 || status >= 300) return;

        const taskId = extractTaskId(url);
        if (!taskId || this.isProcessed(taskId) || !this.autoConvertEnabled) return;

        let buffer = null;
        try {
          buffer = await response.body();
        } catch (bodyErr) {
          buffer = await this._fallbackFetch(url);
        }

        if (!buffer || buffer.length === 0) return;

        this.markProcessed(taskId);
        if (this.debugMode) {
          console.log(`[NetworkMonitor] Captured model.meshy for task ${taskId} (${buffer.length} bytes)`);
        }

        if (this.onModelDetected) {
          this.onModelDetected({ taskId, url, buffer, sizeBytes: buffer.length });
        }
      } catch (err) {
        // Silently ignore — never slow down Meshy browsing
      }
    });
  }

  /** Process a matched URL after CDP confirms the body is ready */
  async _processMatchedResponse(url, requestId) {
    try {
      const taskId = extractTaskId(url);
      if (!taskId) return;
      if (this.isProcessed(taskId)) return;
      if (!this.autoConvertEnabled) {
        if (this.debugMode) console.log(`[NetworkMonitor] Model detected for ${taskId}, but auto-convert OFF.`);
        return;
      }

      let buffer = null;

      // Try CDP getResponseBody first
      try {
        const { body, base64Encoded } = await this._cdpSession.send('Network.getResponseBody', { requestId });
        buffer = base64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body, 'binary');
      } catch (cdpErr) {
        if (this.debugMode) console.warn(`[NetworkMonitor] CDP body failed: ${cdpErr.message}`);
        buffer = await this._fallbackFetch(url);
      }

      if (!buffer || buffer.length === 0) {
        console.error(`[NetworkMonitor] Failed to retrieve model binary for task ${taskId}`);
        return;
      }

      this.markProcessed(taskId);
      console.log(`[NetworkMonitor] Captured model.meshy for task ${taskId} (${buffer.length} bytes)`);

      if (this.onModelDetected) {
        this.onModelDetected({ taskId, url, buffer, sizeBytes: buffer.length });
      }
    } catch (err) {
      console.error('[NetworkMonitor] Error processing matched response:', err);
    }
  }

  /** Resilient fallback: context fetch → global fetch */
  async _fallbackFetch(url) {
    // Try Playwright authenticated context
    try {
      if (this.listeningPage && !this.listeningPage.isClosed()) {
        const res = await this.listeningPage.request.get(url);
        if (res.ok()) return await res.body();
      }
    } catch (e) {
      if (this.debugMode) console.warn(`[NetworkMonitor] Context fetch failed: ${e.message}`);
    }

    // Try global fetch (may work for non-authed URLs)
    try {
      const res = await fetch(url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (this.debugMode) console.warn(`[NetworkMonitor] Global fetch failed: ${e.message}`);
    }

    return null;
  }
}
