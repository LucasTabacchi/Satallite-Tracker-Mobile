import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CelesTrakProvider } from '../src/providers/celestrak';
import { WhereTheIssProvider } from '../src/providers/wheretheiss';
import { getJson, UpstreamHttpError } from '../src/providers/http';
import { UnsupportedOperationError } from '../src/providers/types';
import { vanguard } from './fixture';

const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
test('CelesTrak reads Starlink supplemental CSV and retains quoted names and six-digit IDs', async () => {
  let url = '';
  const name = 'STARLINK, "DEMO"';
  const row = { ...vanguard, OBJECT_NAME: name, NORAD_CAT_ID: 123456 };
  const encode = (value: unknown) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = `\uFEFF${Object.keys(row).join(',')}\r\n${Object.values(row).map(encode).join(',')}\r\n`;
  const provider = new CelesTrakProvider(async (input, init) => {
    url = String(input);
    if (new URL(url).searchParams.get('FORMAT') !== 'CSV') return new Response(null, { status: 403 });
    assert.equal(new Headers(init?.headers).get('Accept'), 'text/csv');
    return new Response(csv, { headers: { 'Content-Type': 'text/plain; charset=UTF-8' } });
  });
  const rows = await provider.getCatalog({ group: 'starlink' });
  assert.equal(new URL(url).pathname, '/NORAD/elements/supplemental/sup-gp.php');
  assert.equal(new URL(url).searchParams.get('FILE'), 'starlink');
  assert.equal(rows[0].NORAD_CAT_ID, 123456);
  assert.equal(rows[0].OBJECT_NAME, name);
  await assert.rejects(provider.getValidationPosition({ noradId: 123456, at: new Date(), observer: { latitude: 0, longitude: 0, altitudeKm: 0 } }), /does not support validation/);
});

test('Starlink CSV rejects malformed input without requesting a different catalog', async () => {
  let calls = 0;
  const provider = new CelesTrakProvider(async () => { calls++; return new Response('OBJECT_NAME,NORAD_CAT_ID\n"STARLINK,123456'); });
  await assert.rejects(provider.getOrbitalData({ group: 'starlink' }), /invalid.*CSV/i);
  assert.equal(calls, 1);
});

test('weather and explicit NORAD queries still use CelesTrak GP JSON', async () => {
  const calls: URL[] = [];
  const provider = new CelesTrakProvider(async (input, init) => {
    calls.push(new URL(String(input)));
    assert.equal(new Headers(init?.headers).get('Accept'), 'application/json');
    return response([vanguard]);
  });
  await provider.getOrbitalData({ group: 'weather' });
  await provider.getOrbitalData({ group: 'starlink', noradId: 5 });
  assert.deepEqual(calls.map(url => url.pathname), ['/NORAD/elements/gp.php', '/NORAD/elements/gp.php']);
  assert.deepEqual(calls.map(url => url.searchParams.get('FORMAT')), ['JSON', 'JSON']);
  assert.equal(calls[0]?.searchParams.get('GROUP'), 'WEATHER');
  assert.equal(calls[1]?.searchParams.get('CATNR'), '5');
});
test('WhereTheISS adapter only validates ISS and returns the exact requested timestamp', async () => {
  let url = '';
  const provider = new WhereTheIssProvider(async input => { url = String(input); return response({ id: 25544, latitude: 0, longitude: 1, altitude: 420, timestamp: 1000 }); });
  const at = new Date(1_000_000);
  const position = await provider.getValidationPosition({ noradId: 25544, at, observer: { latitude: 0, longitude: 0, altitudeKm: 0 } });
  assert.equal(new URL(url).searchParams.get('timestamp'), '1000');
  assert.equal(position.timestamp.getTime(), at.getTime());
  await assert.rejects(provider.getValidationPosition({ noradId: 12345, at, observer: { latitude: 0, longitude: 0, altitudeKm: 0 } }), error => error instanceof UnsupportedOperationError);
});

test('HTTP failures expose only status and parsed Retry-After metadata', async () => {
  await assert.rejects(getJson(async () => new Response('secret upstream body', { status: 429, headers: { 'Retry-After': '3' } }), 'https://example.invalid/private?key=secret'), error => {
    assert.ok(error instanceof UpstreamHttpError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterMs, 3000);
    assert.equal(error.message, 'Upstream request failed (429)');
    assert.equal(error.message.includes('secret'), false);
    return true;
  });
  await assert.rejects(getJson(async () => new Response('', { status: 400 }), 'https://example.invalid'), error => {
    assert.ok(error instanceof UpstreamHttpError);
    assert.equal(error.retryAfterMs, undefined);
    return true;
  });
});
test('the ISS-only orbital provider declines unrelated group loads but still serves the explicit ISS and stations', async () => {
  let calls = 0;
  const provider = new WhereTheIssProvider(async () => {
    calls++;
    return Response.json({
      id: '25544', name: 'ISS', tle_timestamp: 0,
      line1: '1 25544U 98067A   13080.79204657  .00017831  00000-0  40606-3 0  4540',
      line2: '2 25544  51.6478 182.2316 0011718  59.7125  80.2831 15.52100765821132',
    });
  });
  for (const group of ['starlink', 'weather', 'gps-ops', 'active'] as const) {
    await assert.rejects(provider.getOrbitalData({ group }), { name: 'UnsupportedOperationError' });
  }
  assert.equal(calls, 0);
  assert.equal((await provider.getOrbitalData({ group: 'stations' }))[0]?.NORAD_CAT_ID, 25544);
  assert.equal((await provider.getOrbitalData({ noradId: 25544 }))[0]?.NORAD_CAT_ID, 25544);
  assert.equal(calls, 2);
});
