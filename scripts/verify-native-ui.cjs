/* Functional checks of the actual Expo web export, with explicitly mocked providers. */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  if (!process.env.APP_WEB_DIST) throw new Error('APP_WEB_DIST must identify an existing Expo web export.');
  const root = path.resolve(process.env.APP_WEB_DIST);
  const evidence = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/evidence/validation-2026-11-03T21-21-39-080Z.json'), 'utf8'))[0];
  const element = { ...evidence.elements, EPOCH: new Date(Date.now() - 3600_000).toISOString() };
  const output = path.resolve(process.env.UI_TEST_OUTPUT || path.join(__dirname, '../output/native-ui'));
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const candidate = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!candidate.startsWith(root + path.sep) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      response.writeHead(404).end(); return;
    }
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
    response.writeHead(200, { 'Content-Type': types[path.extname(candidate)] || 'application/octet-stream' });
    fs.createReadStream(candidate).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser, page;
  const errors = [], unexpected = [], calls = [];
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', reducedMotion: 'reduce', recordVideo: { dir: output } });
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.hostname === 'celestrak.org') {
        calls.push(url.href);
        const rows = url.searchParams.get('GROUP')?.toLowerCase() === 'stations' ? [element] : Array.from({ length: 60 }, (_, index) => ({ ...element, NORAD_CAT_ID: 100000 + index, OBJECT_NAME: `TEST STARLINK ${index}` }));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
      }
      if (url.hostname === 'api.wheretheiss.at') {
        calls.push(url.href);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 25544, latitude: 0, longitude: 0, altitude: 420, timestamp: Number(url.searchParams.get('timestamp')) }) });
      }
      unexpected.push(url.href); return route.abort();
    });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Catálogo', exact: true }).click();
    await page.getByRole('button', { name: /Seleccionar ISS/ }).click();
    await page.getByText('NORAD 25544', { exact: true }).waitFor();
    const map = page.getByLabel('Mapa mundial de satélites');
    await map.waitFor();
    const before = await map.innerHTML();
    await page.waitForTimeout(2400);
    assert.notEqual(await map.innerHTML(), before, 'marker should move using local propagation');
    assert.equal(calls.length, 1, 'local ticks should not fetch');

    await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
    await page.getByLabel('Latitud', { exact: true }).fill('-34.6037');
    await page.getByLabel('Longitud', { exact: true }).fill('-58.3816');
    await page.getByLabel('Altitud (m)', { exact: true }).fill('25');
    await page.getByRole('button', { name: 'Aplicar ubicación', exact: true }).click();
    await page.getByRole('button', { name: '10°', exact: true }).click();
    await page.getByRole('button', { name: 'Validar con Where the ISS at?', exact: true }).click();
    await page.getByLabel('Resultado de validación').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Validar con N2YO', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Cielo', exact: true }).click();
    await page.getByLabel('Carta polar norte arriba; el centro representa el cenit').waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Iniciar brújula', exact: true }).click();
    await page.getByText(/Brújula no disponible:/).waitFor();
    await page.getByRole('button', { name: 'Pases', exact: true }).click();
    await page.getByText(/AOS ·/).first().waitFor();
    await page.getByRole('button', { name: 'Activar aviso', exact: true }).click();
    await page.getByText(/recordatorios.*versión web/i).first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'Desactivar aviso', exact: true }).count(), 0, 'web must not claim notification success');

    let viewportCases = 0;
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      for (const tab of ['Seguimiento', 'Cielo', 'Pases', 'Catálogo', 'Ajustes']) {
        await page.getByRole('button', { name: tab, exact: true }).click();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
        assert.equal(overflow, false, `${tab} overflow at ${width}`);
        viewportCases++;
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Catálogo', exact: true }).click();
    await page.getByRole('button', { name: 'Starlink', exact: true }).click();
    await page.getByLabel('Buscar por nombre o NORAD').fill('100010');
    await page.getByRole('button', { name: 'Seleccionar TEST STARLINK 10, NORAD 100010', exact: true }).click();
    await page.getByRole('button', { name: 'Mostrar constelación · máx. 50', exact: true }).click();
    await page.getByRole('button', { name: 'Ocultar constelación', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'orbit-native-web.png'), fullPage: true });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('NORAD 100010', { exact: true }).waitFor();
    assert.equal(calls.filter(url => url.includes('celestrak.org')).length, 2, 'restored selection should reuse persisted cache');
    assert.deepEqual(unexpected, []);
    assert.deepEqual(errors, []);
    const video = page.video();
    await page.close(); await context.close();
    await video.saveAs(path.join(output, 'orbit-ui-mocked-demo.webm'));
    console.log(JSON.stringify({ status: 'pass', viewportCases, requests: calls.length, mocked: true, output, errors }));
  } catch (error) {
    console.error(JSON.stringify({ errors, unexpected, calls, body: await page?.locator('body').innerText().then(text => text.slice(0, 5000)).catch(() => '') }));
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    throw error;
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
