import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CatalogRepository, CelesTrakProvider, TTL_MS, filterCatalog } from '../src/catalog';
import { parseElements } from '../src/orbit';
import { vanguard } from './fixture';

function setup() {
  let data: string | null = null;
  let calls = 0;
  let offline = false;
  const storage = { getItem: async () => data, setItem: async (_: string, value: string) => { data = value; } };
  const provider = { getCatalog: async () => { calls++; if (offline) throw new Error('offline'); return [parseElements(vanguard)]; } };
  return { repository: new CatalogRepository(provider, storage), calls: () => calls, offline: () => { offline = true; } };
}

test('RF-09: a persisted catalog avoids requests until the exact 24-hour boundary', async () => {
  const { repository, calls } = setup();
  const first = await repository.load(1000);
  assert.equal(first.source, 'network');
  assert.equal((await repository.load(1000 + TTL_MS - 1)).source, 'cache');
  assert.equal(calls(), 1);
  assert.equal((await repository.load(1000 + TTL_MS)).source, 'network');
  assert.equal(calls(), 2);
});

test('RF-14/16: expired data remain available offline with an explicit warning', async () => {
  const { repository, offline } = setup();
  await repository.load(1000);
  offline();
  const result = await repository.load(1000 + TTL_MS);
  assert.equal(result.source, 'stale-cache');
  assert.equal(result.fetchedAt, 1000);
  assert.match(result.warning!, /offline/i);
});

test('RF-01: search supports names and NORAD IDs without changing the catalog', () => {
  const rows = [parseElements(vanguard)];
  assert.equal(filterCatalog(rows, 'vanguard').length, 1);
  assert.equal(filterCatalog(rows, ' 5 ').length, 1);
  assert.equal(filterCatalog(rows, 'ISS').length, 0);
  assert.equal(rows.length, 1);
});

test('provider rejects HTTP failures and malformed catalog responses', async () => {
  for (const response of [new Response('unavailable', { status: 503 }), Response.json({ invalid: true }), Response.json([]), Response.json([{}])]) {
    await assert.rejects(new CelesTrakProvider(async () => response).getCatalog(), /HTTP 503|Invalid/);
  }
});

test('provider requests the public station JSON endpoint and accepts OMM', async () => {
  const provider = new CelesTrakProvider(async (url) => {
    assert.equal(String(url), 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json');
    return Response.json([vanguard]);
  });
  assert.equal((await provider.getCatalog())[0].NORAD_CAT_ID, 5);
});

test('cache failures do not discard fresh network data', async () => {
  const storage = { getItem: async () => { throw new Error('disk'); }, setItem: async () => { throw new Error('disk'); } };
  const repository = new CatalogRepository({ getCatalog: async () => [parseElements(vanguard)] }, storage);
  const result = await repository.load(1000);
  assert.equal(result.source, 'network');
  assert.match(result.warning!, /cache/i);
});
