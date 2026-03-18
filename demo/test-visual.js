#!/usr/bin/env node

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROMIUM_PATH = '/snap/bin/chromium';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const BASE_URL = 'http://76.13.221.42/maw';

const PAGES = [
  { name: 'index', url: `${BASE_URL}/`, expectedTitleFragment: null },
  { name: 'soul', url: `${BASE_URL}/soul.html`, expectedTitleFragment: null },
  { name: 'universe', url: `${BASE_URL}/universe.html`, expectedTitleFragment: null, extra: 'threejs' },
];

async function testPage(browser, page, pageConfig, results) {
  const { name, url, extra } = pageConfig;
  const result = { name, url, passed: true, errors: [], warnings: [], title: '' };
  const consoleErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push(err.message);
  });

  try {
    // Navigate
    console.log(`\n--- Testing: ${name} (${url}) ---`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Extra wait for Three.js pages
    if (extra === 'threejs') {
      console.log('  Waiting 3s for Three.js render + star-birth animation...');
      await new Promise(r => setTimeout(r, 3000));
    }

    // Get title
    result.title = await page.title();
    console.log(`  Title: "${result.title}"`);
    if (!result.title || result.title.trim() === '') {
      result.warnings.push('Page title is empty');
    }

    // Check for canvas on universe page
    if (extra === 'threejs') {
      const canvasExists = await page.$('canvas');
      if (canvasExists) {
        console.log('  Canvas element: FOUND');
      } else {
        result.passed = false;
        result.errors.push('Canvas element NOT found (Three.js may have failed to render)');
        console.log('  Canvas element: NOT FOUND');
      }
    }

    // Take screenshot
    const screenshotPath = path.join(SCREENSHOT_DIR, `${name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const stats = fs.statSync(screenshotPath);
    console.log(`  Screenshot: ${screenshotPath} (${(stats.size / 1024).toFixed(1)} KB)`);

    // Check console errors
    if (consoleErrors.length > 0) {
      // Filter out common non-critical errors
      const critical = consoleErrors.filter(e =>
        !e.includes('favicon') &&
        !e.includes('DevTools') &&
        !e.includes('third-party')
      );
      if (critical.length > 0) {
        result.warnings.push(`${critical.length} JS console error(s)`);
        critical.forEach(e => console.log(`  Console error: ${e}`));
      }
    }

  } catch (err) {
    result.passed = false;
    result.errors.push(err.message);
    console.log(`  ERROR: ${err.message}`);
  }

  results.push(result);
}

async function main() {
  console.log('=== MAW Visual Test Suite ===');
  console.log(`Chromium: ${CHROMIUM_PATH}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
  console.log(`Pages to test: ${PAGES.length}\n`);

  // Ensure screenshot dir exists
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const results = [];

  for (const pageConfig of PAGES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await testPage(browser, page, pageConfig, results);
    await page.close();
  }

  await browser.close();

  // Print summary
  console.log('\n\n========== RESULTS SUMMARY ==========');
  console.log(`Total pages tested: ${results.length}`);
  console.log('');

  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    if (!r.passed) allPassed = false;
    console.log(`  [${status}] ${r.name}`);
    console.log(`         URL: ${r.url}`);
    console.log(`         Title: "${r.title}"`);
    if (r.errors.length > 0) {
      r.errors.forEach(e => console.log(`         ERROR: ${e}`));
    }
    if (r.warnings.length > 0) {
      r.warnings.forEach(w => console.log(`         WARN: ${w}`));
    }
    console.log('');
  }

  console.log(`Overall: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);
  console.log('=====================================');

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
