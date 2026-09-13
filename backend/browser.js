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
    this.screencastInterval = null;
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

      // Determine if a display server is present for headful mode
      const hasDisplay = process.env.DISPLAY || process.env.WAYLAND_DISPLAY;

      console.log(`[BrowserController] Launching Chromium persistent context (hasDisplay=${!!hasDisplay})...`);

      this.context = await chromium.launchPersistentContext(this.userDataDir, {
        headless: !hasDisplay, // Launches headful window on Desktop Linux if display exists
        viewport: { width: 1280, height: 800 },
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox'
        ]
      });

      const pages = this.context.pages();
      this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

      // Attach network monitor to intercept model.meshy responses
      if (this.networkMonitor) {
        this.networkMonitor.attach(this.page);
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

      // Start live screencast for remote dashboard viewing
      this.startScreencast();

    } catch (err) {
      console.error('[BrowserController] Error launching browser:', err);
      this.setStatus('Error');
      this.stopScreencast();
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
        // If logged in, ensure we are on the workspace page
        if (!url.includes('workspace')) {
          await this.page.goto(this.targetWorkspaceUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        }
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
      this.setStatus('Meshy loading');
      await this.page.goto(this.targetWorkspaceUrl, { waitUntil: 'domcontentloaded' });
      await this.checkAuthState();
    } catch (err) {
      console.error('[BrowserController] Reconnect error:', err);
      this.setStatus('Error');
    }
  }

  async closeBrowser() {
    this.stopScreencast();
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

  startScreencast() {
    this.stopScreencast();

    // Stream JPEG screenshots to WebSocket clients (e.g. 5 FPS)
    this.screencastInterval = setInterval(async () => {
      if (!this.page || this.page.isClosed()) return;

      try {
        const screenshot = await this.page.screenshot({
          type: 'jpeg',
          quality: 60,
          animations: 'disabled'
        });

        if (this.onScreencastFrame) {
          this.onScreencastFrame(screenshot.toString('base64'));
        }

        // Periodically update state
        const currentUrl = this.page.url();
        if (currentUrl.includes('workspace') && this.status !== 'Ready' && this.status !== 'Monitoring') {
          this.setStatus('Ready');
        }
      } catch (err) {
        // Suppress transient screenshot errors (e.g., during navigation)
      }
    }, 200);
  }

  stopScreencast() {
    if (this.screencastInterval) {
      clearInterval(this.screencastInterval);
      this.screencastInterval = null;
    }
  }

  /**
   * Forwards remote mouse/keyboard interaction events from the web dashboard
   * to the Playwright page.
   */
  async handleUserInteraction(interaction) {
    if (!this.page || this.page.isClosed()) return;

    try {
      const { type, x, y, key, text, deltaY } = interaction;

      if (type === 'click') {
        await this.page.mouse.click(x, y);
      } else if (type === 'type') {
        await this.page.keyboard.type(text);
      } else if (type === 'keydown') {
        await this.page.keyboard.press(key);
      } else if (type === 'scroll') {
        await this.page.mouse.wheel(0, deltaY || 100);
      } else if (type === 'navigate') {
        await this.page.goto(interaction.url || this.targetWorkspaceUrl);
      }
    } catch (err) {
      console.warn('[BrowserController] Interaction handling error:', err.message);
    }
  }
}
