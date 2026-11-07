import test from 'node:test';
import assert from 'node:assert/strict';
import { N2yoProvider, SpaceTrackProvider } from '../server/providers';
import { UnsupportedOperationError } from '../src/providers/types';
import { vanguard } from './fixture';

const stamp = Date.parse('2026-10-28T00:00:00Z');
const observer = { latitude: 1, longitude: 2, altitudeKm: 0.5 };
const query = { noradId: 25544, at: new Date(stamp + 60_000), observer };

test('Space-Track rejects unsupported curated groups before authentication for both methods', async () => {
  let calls = 0;
  const provider = new SpaceTrackProvider({ identity: 'fixture', password: 'fixture' }, async () => {
    calls++;
    return Response.json([vanguard], { headers: { 'set-cookie': 'session=fixture' } });
  });
  for (const group of ['stations', 'starlink', 'gps-ops', 'weather'] as const) {
    await assert.rejects(provider.getCatalog({ group }), error => error instanceof UnsupportedOperationError);
    await assert.rejects(provider.getOrbitalData({ group }), error => error instanceof UnsupportedOperationError);
  }
  assert.equal(calls, 0);
});

test('Space-Track retains active catalog and explicit NORAD queries for both methods', async () => {
  const urls: string[] = [];
  const provider = new SpaceTrackProvider({ identity: 'fixture', password: 'fixture' }, async input => {
    urls.push(String(input));
    return Response.json([vanguard], { headers: { 'set-cookie': 'session=fixture' } });
  });
  for (const method of ['getCatalog', 'getOrbitalData'] as const) {
    assert.equal((await provider[method]({ group: 'active' }))[0].NORAD_CAT_ID, 5);
    assert.match(urls.at(-1)!, /DECAY_DATE\/null-val/);
    assert.equal((await provider[method]({ group: 'stations', noradId: 5 }))[0].NORAD_CAT_ID, 5);
    assert.match(urls.at(-1)!, /NORAD_CAT_ID\/5/);
  }
  assert.equal(urls.filter(url => url.endsWith('/ajaxauth/login')).length, 1);
});

test('N2YO normal orbital requests retain TLE parsing behavior', async () => {
  const provider = new N2yoProvider({ apiKey: 'fixture-only' }, async () => Response.json({
    info: { satid: 25544 },
    tle: '1 25544U 98067A   13080.79204657  .00024647  00000-0  40606-3 0  4540\n2 25544  51.6478 182.2316 0011718  59.7125  80.2831 15.52100765821132',
  }));
  const [elements] = await provider.getOrbitalData({ noradId: 25544 });
  assert.equal(elements.NORAD_CAT_ID, 25544);
  assert.equal(elements.MEAN_MOTION, 15.52100765);
  assert.equal(elements.INCLINATION, 51.6478);
});

test('N2YO converts observer altitude to meters and includes the requested final second', async t => {
  t.mock.method(Date, 'now', () => stamp);
  const provider = new N2yoProvider({ apiKey: 'fixture-only' }, async input => {
    const parts = new URL(String(input)).pathname.split('/').filter(Boolean);
    assert.equal(parts.at(-2), '500');
    assert.equal(parts.at(-1), '61');
    return Response.json({ info: { satid: 25544 }, positions: Array.from({ length: Number(parts.at(-1)) }, (_, i) => ({
      timestamp: stamp / 1000 + i, satlatitude: 3, satlongitude: 4, sataltitude: 420,
    })) });
  });
  assert.deepEqual(await provider.getValidationPosition(query), {
    noradId: 25544, timestamp: query.at, latitude: 3, longitude: 4, altitudeKm: 420,
  });
});

test('N2YO rejects historical and beyond-300-sample requests without transport', async t => {
  t.mock.method(Date, 'now', () => stamp);
  let calls = 0;
  const provider = new N2yoProvider({ apiKey: 'fixture-only' }, async () => { calls++; return Response.json({}); });
  for (const offset of [-1, 300]) await assert.rejects(provider.getValidationPosition({ ...query, at: new Date(stamp + offset * 1000) }), /300-position/);
  assert.equal(calls, 0);
});

test('N2YO supports current-second and inclusive 300-position boundary', async t => {
  t.mock.method(Date, 'now', () => stamp + 500);
  for (const offset of [0, 299]) {
    const provider = new N2yoProvider({ apiKey: 'fixture-only' }, async input => {
      const count = Number(new URL(String(input)).pathname.split('/').filter(Boolean).at(-1));
      assert.equal(count, offset + 1);
      return Response.json({ info: { satid: 25544 }, positions: [{
        timestamp: stamp / 1000 + offset, satlatitude: 3, satlongitude: 4, sataltitude: 420,
      }] });
    });
    assert.equal((await provider.getValidationPosition({ ...query, at: new Date(stamp + offset * 1000) })).timestamp.getTime(), stamp + offset * 1000);
  }
});

test('pre-aborted N2YO orbital and validation calls do not reach transport', async t => {
  t.mock.method(Date, 'now', () => stamp);
  let calls = 0;
  const provider = new N2yoProvider({ apiKey: 'fixture-only' }, async () => { calls++; return Response.json({}); });
  const signal = AbortSignal.abort();
  await assert.rejects(provider.getOrbitalData({ noradId: 25544, signal }));
  await assert.rejects(provider.getValidationPosition({ ...query, signal }));
  assert.equal(calls, 0);
});

test('active cancellation reaches N2YO transport for both operations', async t => {
  t.mock.method(Date, 'now', () => stamp);
  for (const operation of ['orbital', 'validation']) {
    const controller = new AbortController();
    let transportSignal: AbortSignal | null | undefined;
    const provider = new N2yoProvider({ apiKey: 'fixture-only' }, async (_input, init) => {
      transportSignal = init?.signal;
      // Bound the probe even if the provider incorrectly loses cancellation.
      return new Promise<Response>((resolve, reject) => {
        const timeout = setTimeout(() => resolve(Response.json({})), 30);
        transportSignal?.addEventListener('abort', () => { clearTimeout(timeout); reject(new Error('Transport aborted')); }, { once: true });
      });
    });
    const pending = operation === 'orbital' ? provider.getOrbitalData({ noradId: 25544, signal: controller.signal }) :
      provider.getValidationPosition({ ...query, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, /Transport aborted/);
    assert.equal(transportSignal?.aborted, true);
  }
});
