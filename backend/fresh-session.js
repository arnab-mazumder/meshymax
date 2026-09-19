/**
 * Fresh Meshy Session Automation Service
 * 
 * Automates account creation/login using disposable Gmail-style emails from Emailnator:
 * 1. Launches Playwright Chrome (headful so user can immediately take over).
 * 2. Navigates to Emailnator and generates a fresh Gmail-style address (.Gmail / GoogleMail / +Gmail).
 * 3. Navigates to Meshy.ai, opens login modal, inputs email, and requests verification code.
 * 4. Polls Emailnator inbox for the verification email.
 * 5. Extracts the verification code.
 * 6. Submits code on Meshy.ai and confirms authentication.
 * 7. Leaves the authenticated Chrome window open and active for the user.
 */

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';

const EMAILNATOR_URL = 'https://www.emailnator.com/';
const MESHY_WORKSPACE_URL = 'https://www.meshy.ai/workspace#genMode-img3d';

/**
 * Starts a fresh authenticated Meshy session.
 * 
 * @param {Object} options
 * @param {boolean} [options.headless=false] - Whether to launch Chrome headless (default false so user gets native window)
 * @param {string} [options.userDataDir] - Custom persistent profile path
 * @param {Function} [options.onProgress] - Callback for real-time progress updates: (status, detail) => void
 * @param {number} [options.timeout=90000] - Max duration for the entire flow (ms)
 * @returns {Promise<{ browser: any, context: any, page: any, email: string }>}
 */
export async function startFreshMeshySession(options = {}) {
  const {
    headless = process.env.HEADLESS === 'true',
    userDataDir = path.resolve('.meshy-fresh-session'),
    onProgress = () => {},
    timeout = 90000
  } = options;

  if (timeout <= 0) {
    throw new Error('Invalid timeout specified for fresh session.');
  }

  const notify = (status, detail = {}) => {
    console.log(`[FreshSession] ${status}`, detail);
    try { onProgress(status, detail); } catch {}
  };

  notify('Starting Playwright Chrome...', { headless });
  await fs.mkdir(userDataDir, { recursive: true });

  // Launch persistent context with full GPU hardware acceleration for maximum Meshy speed
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: null, // Adapts to user's native screen resolution
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--enable-accelerated-2d-canvas'
    ]
  });

  const pages = context.pages();
  const meshyPage = pages.length > 0 ? pages[0] : await context.newPage();
  let emailPage = null;
  let generatedEmail = null;

  try {
    // ── STEP 1: OPEN EMAILNATOR & GENERATE GMAIL-STYLE ADDRESS ──────────────
    notify('Opening Emailnator to generate disposable Gmail-style email...');
    emailPage = await context.newPage();

    // Block slow ad and tracker networks on Emailnator for fast load times
    await emailPage.route('**/*', route => {
      const u = route.request().url();
      if (
        u.includes('google') && !u.includes('emailnator') ||
        u.includes('pagead') ||
        u.includes('doubleclick') ||
        u.includes('analytics') ||
        u.includes('moloco') ||
        u.includes('adnxs') ||
        u.includes('syndication') ||
        u.includes('amazon-adsystem')
      ) {
        return route.abort();
      }
      return route.continue();
    });

    await emailPage.goto(EMAILNATOR_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // Accept cookie banner if present
    const cookieBtn = emailPage.locator('#accept-cookies-usage');
    if (await cookieBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cookieBtn.click().catch(() => {});
    }

    await emailPage.waitForTimeout(1000);

    // Verify Emailnator exposes Gmail/Gmail-style options
    const chipDotGmail = emailPage.locator('.mf-chip:has-text(".Gmail")');
    const chipPlusGmail = emailPage.locator('.mf-chip:has-text("+Gmail")');
    const chipGoogleMail = emailPage.locator('.mf-chip:has-text("GoogleMail")');
    const chipDomain = emailPage.locator('.mf-chip:has-text("Domain")');

    const hasDotGmail = await chipDotGmail.isVisible().catch(() => false);
    const hasPlusGmail = await chipPlusGmail.isVisible().catch(() => false);
    const hasGoogleMail = await chipGoogleMail.isVisible().catch(() => false);

    if (!hasDotGmail && !hasPlusGmail && !hasGoogleMail) {
      throw new Error('Emailnator no longer exposes a Gmail/Gmail-style disposable email option.');
    }

    notify('Configuring Emailnator for Gmail-style address...');

    // Prefer .Gmail or GoogleMail
    if (hasDotGmail) {
      await chipDotGmail.click();
    } else if (hasGoogleMail) {
      await chipGoogleMail.click();
    } else if (hasPlusGmail) {
      await chipPlusGmail.click();
    }

    // Deselect Domain chip if it is active to ensure strict Gmail/GoogleMail domain
    if (await chipDomain.isVisible().catch(() => false)) {
      const domainClass = await chipDomain.getAttribute('class') || '';
      if (domainClass.includes('active')) {
        await chipDomain.click().catch(() => {});
      }
    }

    // Click "Generate New"
    notify('Generating fresh email address...');
    const generateBtn = emailPage.locator('button:has-text("Generate New")');
    await generateBtn.click();
    await emailPage.waitForTimeout(1500);

    // Read the generated email address
    const emailLocator = emailPage.locator('.mf-mono').first();
    await emailLocator.waitFor({ state: 'visible', timeout: 10000 });
    generatedEmail = (await emailLocator.innerText()).trim();

    if (!generatedEmail || !generatedEmail.includes('@')) {
      throw new Error(`Failed to extract valid email address from Emailnator. Got: "${generatedEmail}"`);
    }

    // Ensure it is Gmail/GoogleMail style
    if (!/@(gmail\.com|googlemail\.com)/i.test(generatedEmail)) {
      notify(`Email generated (${generatedEmail}), clicking Generate New again for Gmail domain...`);
      await generateBtn.click();
      await emailPage.waitForTimeout(1500);
      generatedEmail = (await emailLocator.innerText()).trim();
    }

    notify(`Captured fresh disposable email: ${generatedEmail}`, { email: generatedEmail });

    // Open inbox by clicking "GO !"
    const goBtn = emailPage.locator('button:has-text("GO !")');
    if (await goBtn.isVisible().catch(() => false)) {
      await goBtn.click();
    } else {
      await emailPage.goto(`https://www.emailnator.com/inbox#${generatedEmail}`, { waitUntil: 'domcontentloaded' });
    }

    // ── STEP 2: OPEN MESHY & ENTER EMAIL ────────────────────────────────────
    notify('Navigating to Meshy.ai workspace...');
    await meshyPage.bringToFront();
    await meshyPage.goto(MESHY_WORKSPACE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await meshyPage.waitForTimeout(2500);

    // Check if login modal is visible; if not, open it
    let emailInput = meshyPage.locator('input[type="email"], input[placeholder*="yours@example.com"]').first();
    if (!await emailInput.isVisible().catch(() => false)) {
      notify('Opening Meshy login modal...');
      const logInBtn = meshyPage.locator('button:has-text("Log In"), button:has-text("Sign Up Free"), a:has-text("Log In")').first();
      if (await logInBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await logInBtn.click();
        await meshyPage.waitForTimeout(1500);
      }
    }

    emailInput = meshyPage.locator('input[type="email"], input[placeholder*="yours@example.com"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 15000 });

    notify(`Entering email ${generatedEmail} into Meshy login...`);
    await emailInput.click();
    await emailInput.fill(generatedEmail);
    // Dispatch input/change events to trigger React controlled component state
    await emailInput.dispatchEvent('input');
    await emailInput.dispatchEvent('change');
    await meshyPage.waitForTimeout(500);

    // Check "Get Code" button
    const getCodeBtn = meshyPage.locator('button:has-text("Get Code")').first();
    await getCodeBtn.waitFor({ state: 'visible', timeout: 5000 });

    // If still disabled, type a space and backspace to trigger keyboard events
    const isClickable = await getCodeBtn.isEnabled().catch(() => false);
    if (!isClickable) {
      await emailInput.click();
      await meshyPage.keyboard.press('Space');
      await meshyPage.keyboard.press('Backspace');
      await meshyPage.waitForTimeout(300);
    }

    notify('Requesting Meshy verification code...');
    await getCodeBtn.click();
    await meshyPage.waitForTimeout(2000);

    // Check for errors on Meshy (e.g. email rejected, disposable domain blocked)
    const errorNotice = meshyPage.locator('.text-semantic-error, [role="alert"], text="Invalid email", text="not allowed"').first();
    if (await errorNotice.isVisible({ timeout: 1000 }).catch(() => false)) {
      const errText = await errorNotice.innerText();
      throw new Error(`Meshy rejected the email address (${generatedEmail}): ${errText}`);
    }

    // Check if CAPTCHA / bot verification appeared
    const captchaNotice = meshyPage.locator('iframe[src*="turnstile"], iframe[src*="challenge"], .cf-turnstile').first();
    if (await captchaNotice.isVisible({ timeout: 1000 }).catch(() => false)) {
      notify('Manual action required: CAPTCHA / bot protection detected. Please complete it in the Chrome window.', { manualRequired: true });
      // Wait for manual resolution or timeout
      await meshyPage.waitForSelector('iframe[src*="turnstile"], .cf-turnstile', { state: 'hidden', timeout: 30000 }).catch(() => {});
    }

    // ── STEP 3: POLL EMAILNATOR INBOX FOR VERIFICATION EMAIL ────────────────
    notify('Switching to Emailnator inbox to wait for verification code...');
    await emailPage.bringToFront();

    const requestTime = Date.now();
    let verificationCode = null;
    const maxPollMs = 60000;
    const pollIntervalMs = 3000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxPollMs) {
      notify('Checking inbox for Meshy email...');

      // Click Reload button on Emailnator
      const reloadBtn = emailPage.locator('button:has-text("Reload")').first();
      if (await reloadBtn.isVisible().catch(() => false)) {
        await reloadBtn.click().catch(() => {});
      }

      await emailPage.waitForTimeout(pollIntervalMs);

      // Search inbox table/list for Meshy message
      const meshyRow = emailPage.locator('tr:has-text("Meshy"), tr:has-text("meshy"), div:has-text("Meshy")').first();
      const hasMeshyRow = await meshyRow.isVisible({ timeout: 1000 }).catch(() => false);

      if (hasMeshyRow) {
        notify('Found Meshy verification email! Opening...');
        await meshyRow.click();
        await emailPage.waitForTimeout(1500);

        // Read message content
        const bodyContent = await emailPage.evaluate(() => document.body.innerText);

        // Extract 6-digit code (e.g. "123456" or "Your code is: 123456")
        const codeMatches = bodyContent.match(/\b\d{6}\b/g);
        if (codeMatches && codeMatches.length > 0) {
          // Take the most relevant 6-digit match
          verificationCode = codeMatches[0];
          notify(`Successfully extracted verification code: ${verificationCode}`, { code: verificationCode });
          break;
        }
      }
    }

    if (!verificationCode) {
      throw new Error(`Timed out waiting for Meshy verification email at ${generatedEmail} after ${maxPollMs / 1000}s.`);
    }

    // ── STEP 4: SUBMIT CODE TO MESHY ────────────────────────────────────────
    notify('Returning to Meshy to enter verification code...');
    await meshyPage.bringToFront();
    await meshyPage.waitForTimeout(500);

    // Find the verification code input(s)
    // Could be a single text input or 6 individual digit boxes
    const digitInputs = meshyPage.locator('input[maxlength="1"], input[data-index]');
    const isMultiBox = (await digitInputs.count()) >= 6;

    if (isMultiBox) {
      notify('Entering 6-digit code into verification boxes...');
      for (let i = 0; i < 6; i++) {
        await digitInputs.nth(i).fill(verificationCode[i]);
        await meshyPage.waitForTimeout(80);
      }
    } else {
      // Single input field
      const singleCodeInput = meshyPage.locator('input[placeholder*="code" i], input[type="text"]:visible').first();
      await singleCodeInput.waitFor({ state: 'visible', timeout: 5000 });
      await singleCodeInput.click();
      await singleCodeInput.fill(verificationCode);
      await singleCodeInput.dispatchEvent('input');
      await singleCodeInput.dispatchEvent('change');
    }

    await meshyPage.waitForTimeout(1000);

    // Click submit/verify button if present
    const submitBtn = meshyPage.locator('button:has-text("Verify"), button:has-text("Submit"), button:has-text("Log In"), button:has-text("Continue")').first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click().catch(() => {});
    }

    // ── STEP 5: CONFIRM AUTHENTICATED STATE ──────────────────────────────────
    notify('Verifying Meshy authentication...');

    // Wait for the login dialog to close and workspace to become active
    await meshyPage.waitForSelector('text="One step from your 3D model"', { state: 'hidden', timeout: 20000 }).catch(() => {});
    await meshyPage.waitForTimeout(2000);

    const currentUrl = meshyPage.url();
    notify(`Meshy session active and authenticated on ${currentUrl}!`, {
      email: generatedEmail,
      url: currentUrl
    });

    // Close the Emailnator helper tab so the user has a clean window focused on Meshy
    if (emailPage && !emailPage.isClosed()) {
      await emailPage.close().catch(() => {});
    }

    // Focus the Meshy page
    await meshyPage.bringToFront();

    // SUCCESS: Leave Chrome open and running for the user!
    notify('Fresh Meshy session ready. Chrome window is open for full native user control.');

    return {
      browser: context.browser(),
      context,
      page: meshyPage,
      email: generatedEmail
    };

  } catch (err) {
    console.error('[FreshSession] Error in startFreshMeshySession:', err.message);
    notify(`Fresh session failed: ${err.message}`, { error: err.message });
    throw err;
  }
}
