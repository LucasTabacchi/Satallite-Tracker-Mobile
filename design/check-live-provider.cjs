// Explicit, one-shot public-provider smoke check. Never part of the offline test suite.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createPreviewServer } = require('./serve.cjs');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const server = createPreviewServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4177, '127.0.0.1', resolve); });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    const responses = [], errors = [];
    page.on('response', response => { if (!response.url().startsWith('http://127.0.0.1')) responses.push({ host: new URL(response.url()).hostname, status: response.status() }); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:4177/');
    await page.waitForFunction(() => ['ready', 'error'].includes(document.querySelector('#map-status').dataset.state), null, { timeout: 35000 });
    const state = await page.locator('#map-status').getAttribute('data-state');
    const first = await page.locator('#satellite-marker').getAttribute('transform');
    if (state === 'ready') await page.waitForFunction(first => document.querySelector('#satellite-marker').getAttribute('transform') !== first, first, { timeout: 7000 });
    const output = path.join(__dirname, '..', 'output/playwright'); fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'orbit-live-map.png'), fullPage: true });
    console.log(JSON.stringify({ state, status: await page.locator('#map-status').textContent(), source: await page.locator('#source-summary').textContent(), latitude: await page.locator('#latitude').textContent(), longitude: await page.locator('#longitude').textContent(), updatedAt: await page.locator('#map-clock').getAttribute('data-at'), moved: first !== await page.locator('#satellite-marker').getAttribute('transform'), responses, errors }));
    if (state !== 'ready' || errors.length) process.exitCode = 1;
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
