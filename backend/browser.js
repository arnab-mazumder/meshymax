import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';

export class MeshyBrowserController {
  constructor(options = {}) {
    this.context = null;
    this.page = null;
    this.status = 'Disconnected';
    this.userDataDir = path.resolve('.meshy-session');
    this.onStatusChange = options.onStatusChange || null;
    this.onScreencastFrame = options.onScreencastFrame || null;
    this.networkMonitor = options.networkMonitor || null;
    this.cdpSession = null;
    this.targetWorkspaceUrl = 'https://www.meshy.ai/workspace#genMode-img3d';
  }

  getStatus() {
    return this.status;
  }

  setStatus(newStatus) {
    this.status = newStatus;
    console.log(`[BrowserController] Status changed: ${newStatus}`);
    if (this.onStatusChange) {
      this.onStatusChange(newStatus);
    }
  }

  async launchBrowser() {
    if (this.context && this.page && !this.page.isClosed()) {
      console.log('[BrowserController] Browser already running.');
      return;
    }

    this.setStatus('Browser starting');

    try {
      await fs.mkdir(this.userDataDir, { recursive: true });

      const isHeadless = process.env.HEADLESS !== 'false';
      console.log(`[BrowserController] Launching Chromium persistent context (headless=${isHeadless})...`);

      this.context = await chromium.launchPersistentContext(this.userDataDir, {
        headless: isHeadless,
        viewport: { width: 1440, height: 900 },
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ]
      });

      const pages = this.context.pages();
      this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

      // Create a single CDP session for both screencast and network monitoring
      this.cdpSession = await this.context.newCDPSession(this.page);

      // Attach network monitor via CDP (zero-overhead URL matching)
      if (this.networkMonitor) {
        if (typeof this.networkMonitor.attachCDP === 'function') {
          await this.networkMonitor.attachCDP(this.cdpSession, this.page);
        } else {
          this.networkMonitor.attach(this.page);
        }
      }

      this.page.on('close', () => {
        console.log('[BrowserController] Page closed.');
        this.stopScreencast();
        this.setStatus('Disconnected');
      });

      this.setStatus('Meshy loading');
      console.log(`[BrowserController] Navigating to ${this.targetWorkspaceUrl}...`);

      await this.page.goto(this.targetWorkspaceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(err => {
        console.warn('[BrowserController] Navigation initial load warning:', err.message);
      });

      // Check URL and auth state
      await this.checkAuthState();

      // Start live screencast
      await this.startScreencast();

    } catch (err) {
      console.error('[BrowserController] Error launching browser:', err);
      this.setStatus('Error');
      await this.stopScreencast();
      throw err;
    }
  }

  async checkAuthState() {
    if (!this.page || this.page.isClosed()) return;

    try {
      const url = this.page.url();
      if (url.includes('login') || url.includes('auth') || url.includes('sign-in')) {
        this.setStatus('Waiting for login');
      } else {
        this.setStatus('Ready');
      }
    } catch (err) {
      console.warn('[BrowserController] Auth state check error:', err.message);
    }
  }

  async reconnectBrowser() {
    if (!this.context || !this.page || this.page.isClosed()) {
      return this.launchBrowser();
    }

    try {
      const currentUrl = this.page.url();
      // Don't re-navigate if already on Meshy workspace
      if (currentUrl.includes('meshy.ai/workspace')) {
        this.setStatus('Ready');
        return;
      }

      this.setStatus('Meshy loading');
      await this.page.goto(this.targetWorkspaceUrl, { waitUntil: 'domcontentloaded' });
      await this.checkAuthState();
    } catch (err) {
      console.error('[BrowserController] Reconnect error:', err);
      this.setStatus('Error');
    }
  }

  async closeBrowser() {
    await this.stopScreencast();
    if (this.context) {
      try {
        await this.context.close();
      } catch (err) {
        console.warn('[BrowserController] Error closing browser context:', err.message);
      }
      this.context = null;
      this.page = null;
    }
    this.setStatus('Disconnected');
  }

  async startScreencast() {
    await this.stopScreencast();

    if (!this.cdpSession) {
      console.warn('[BrowserController] No CDP session available for screencast');
      return;
    }

    try {
      this.cdpSession.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
        try {
          await this.cdpSession.send('Page.screencastFrameAck', { sessionId });
        } catch {}

        if (this.onScreencastFrame) {
          // Deliver as raw Buffer (binary) — eliminates base64 JSON overhead on the wire
          this.onScreencastFrame(Buffer.from(data, 'base64'));
        }

        // Lightweight status check
        try {
          const currentUrl = this.page ? this.page.url() : '';
          if (currentUrl.includes('workspace') && this.status !== 'Ready' && this.status !== 'Monitoring') {
            this.setStatus('Ready');
          }
        } catch {}
      });

      await this.cdpSession.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 60,
        everyNthFrame: 1   // send every frame for maximum fluidity
      });
      console.log('[BrowserController] CDP screencast active.');
    } catch (err) {
      console.error('[BrowserController] Screencast failed:', err.message);
    }
  }

  async stopScreencast() {
    if (this.cdpSession) {
      try {
        await this.cdpSession.send('Page.stopScreencast').catch(() => {});
      } catch {}
    }
  }

  /**
   * Forwards remote mouse/keyboard/resize interaction events from the web dashboard
   * to the Playwright page.
   */
  async handleUserInteraction(interaction) {
    if (!this.page || this.page.isClosed()) return;

    try {
      const { type, x, y, button, key, text, deltaX, deltaY, width, height } = interaction;

      if (type === 'click') {
        await this.page.mouse.click(x, y, { button: button || 'left' });
      } else if (type === 'mousedown') {
        await this.page.mouse.move(x, y);
        await this.page.mouse.down({ button: button || 'left' });
      } else if (type === 'mouseup') {
        await this.page.mouse.move(x, y);
        await this.page.mouse.up({ button: button || 'left' });
      } else if (type === 'mousemove') {
        await this.page.mouse.move(x, y);
      } else if (type === 'scroll' || type === 'wheel') {
        await this.page.mouse.wheel(deltaX || 0, deltaY || 100);
      } else if (type === 'type') {
        await this.page.keyboard.type(text);
      } else if (type === 'keydown') {
        await this.page.keyboard.press(key);
      } else if (type === 'resize' && width && height) {
        const clampedW = Math.max(800, Math.min(2560, Math.round(width)));
        const clampedH = Math.max(600, Math.min(1600, Math.round(height)));
        await this.page.setViewportSize({ width: clampedW, height: clampedH });
      } else if (type === 'navigate') {
        await this.page.goto(interaction.url || this.targetWorkspaceUrl);
      }
    } catch (err) {
      console.warn('[BrowserController] Interaction handling error:', err.message);
    }
  }
}
