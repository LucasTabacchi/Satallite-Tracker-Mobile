// Optional browser verification; uses an existing Playwright installation, not an app dependency.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createPreviewServer } = require('./serve.cjs');

(async () => {
  const server = createPreviewServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4177, '127.0.0.1', resolve); });
  let browser;
  try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  const errors = [];
  const external = [];
  const providerRequests = [];
  const fixture = {
    OBJECT_NAME: 'TEST SATELLITE', OBJECT_ID: '1958-002B', NORAD_CAT_ID: 25544,
    EPOCH: new Date().toISOString(), MEAN_MOTION: 10.82419157, ECCENTRICITY: .1859667,
    INCLINATION: 34.2682, RA_OF_ASC_NODE: 348.7242, ARG_OF_PERICENTER: 331.7664,
    MEAN_ANOMALY: 19.3264, BSTAR: .000028098, MEAN_MOTION_DOT: .00000023,
    MEAN_MOTION_DDOT: 0, ELEMENT_SET_NO: 475,
  };
  await page.route('https://celestrak.org/**', async route => {
    const id = Number(new URL(route.request().url()).searchParams.get('CATNR'));
    providerRequests.push(id);
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify([{ ...fixture, NORAD_CAT_ID: id }]) });
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4177/') && !request.url().startsWith('https://celestrak.org/')) external.push(request.url()); });
  const root = 'http://127.0.0.1:4177/';
  const output = path.join(__dirname, '..', 'output', 'playwright');
  fs.mkdirSync(output, { recursive: true });
  let viewportChecks = 0;
  try {
    await page.goto(root);
    await page.locator('#map-status[data-state="ready"]').waitFor();
    const firstPosition = await page.locator('#satellite-marker').getAttribute('transform');
    const callsBeforeTick = providerRequests.length;
    await page.waitForFunction(first => document.querySelector('#satellite-marker').getAttribute('transform') !== first, firstPosition);
    assert.equal(providerRequests.length, callsBeforeTick, 'SGP4 ticks must not fetch');
    await page.locator('#catalog-status').waitFor({ state: 'attached' });
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ['track', 'sky', 'passes', 'catalog']) {
        await page.goto(`${root}#${route}`);
        await page.locator(`#page-${route}`).waitFor({ state: 'visible' });
        const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, height: innerHeight, active: [...document.querySelectorAll('.navigation [aria-current="page"]')].length }));
        assert.ok(geometry.scroll <= width, `${route}: overflow at ${width}: ${geometry.scroll}`);
        assert.equal(geometry.active, 1, `${route}: one navigation item must be current`);
        viewportChecks++;
      }
    }
    await page.setViewportSize({ width: 320, height: 900 });
    for (const route of ['track', 'sky', 'passes', 'catalog']) {
      await page.goto(`${root}#${route}`);
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route}: overflow with 200% text at 320px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${root}#catalog`);
    await page.getByRole('searchbox').fill('25544');
    assert.equal(await page.locator('.catalog-card').count(), 1);
    await page.getByRole('button', { name: 'Ciencia', exact: true }).click();
    await page.getByText('¿Buscamos un poco más allá?').waitFor();
    await page.getByRole('button', { name: 'Borrar búsqueda y filtros' }).click();
    assert.equal(await page.locator('.catalog-card').count(), 4);
    await page.getByRole('button', { name: 'Seguir HUBBLE', exact: true }).click();
    await page.locator('#map-status[data-state="ready"]').waitFor();
    assert.equal(await page.locator('#satellite-short').textContent(), 'Hubble');
    assert.ok(Number((await page.locator('#altitude').textContent()).replace(',', '.')) > 0);
    assert.equal(await page.locator('#toggle-track').isDisabled(), false);
    await page.getByRole('button', { name: 'Cobertura', exact: true }).click();
    assert.equal(await page.locator('#toggle-footprint').getAttribute('aria-pressed'), 'false');
    await page.getByRole('link', { name: 'Pases' }).click();
    const reminder = page.getByRole('button', { name: 'Recordatorio de prueba para el pase de las 19:08' });
    await reminder.click();
    assert.equal(await reminder.getAttribute('aria-pressed'), 'true');
    await page.getByLabel('Avisarme antes de un pase').selectOption('5');
    assert.match(await page.locator('#reminder-summary').textContent(), /1 recordatorio de prueba · 5 minutos/);
    await reminder.click();
    assert.equal(await reminder.getAttribute('aria-pressed'), 'false');
    await page.getByRole('button', { name: 'Buenos Aires' }).click();
    assert.equal(await page.locator('#observer-dialog').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#observer-dialog').isVisible(), false);
    assert.equal(await page.getByRole('button', { name: 'Buenos Aires' }).evaluate(el => el === document.activeElement), true);
    await page.getByRole('link', { name: 'Catálogo', exact: true }).click();
    for (const state of ['loading', 'offline', 'error']) {
      await page.getByLabel('Estado de prueba').selectOption(state);
      assert.match(await page.locator('#catalog-status').textContent(), /^Demostración:/);
    }
    await page.getByRole('button', { name: 'Reintentar demostración' }).click();
    assert.equal(await page.locator('.catalog-card').count(), 4);
    await page.getByRole('searchbox').fill('<img src=x onerror=alert(1)>');
    assert.equal(await page.locator('#catalog-list img').count(), 0);
    assert.equal(await page.locator('.empty-state').count(), 1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.page:not([hidden])').evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.goto(root);
    assert.equal(await page.locator('#satellite-short').textContent(), 'ISS');
    await page.goto(`${root}#passes`);
    assert.equal(await page.locator('[data-reminder="pass-1"]').getAttribute('aria-pressed'), 'false');
    for (const route of ['track', 'sky', 'passes', 'catalog']) {
      await page.goto(`${root}#${route}`);
      await page.locator(`#page-${route}`).waitFor({ state: 'visible' });
      if (route === 'track') await page.locator('#map-status[data-state="ready"]').waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => scrollY), 0, `${route}: navigation must start at the top`);
      await page.screenshot({ path: path.join(output, `orbit-mobile-${route}.png`), fullPage: false });
    }
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.goto(root);
    await page.locator('#map-status[data-state="ready"]').waitFor();
    await page.screenshot({ path: path.join(output, 'orbit-desktop.png'), fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(JSON.stringify({ viewportChecks, interactions: 'passed', mockedProviderRequests: providerRequests, pageErrors: errors, unexpectedExternalRequests: external, screenshots: output }));
  } finally {
    await browser.close();
  }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
