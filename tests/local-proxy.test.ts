import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createLocalProxy, LOCAL_PROXY_HOST } from '../server/local-proxy';
import { ProxyProvider } from '../src/providers/proxy-client';
import { vanguard } from './fixture';

const env = { SPACETRACK_IDENTITY: 'fixture-user', SPACETRACK_PASSWORD: 'fixture-&-password' };

test('local proxy requires both credentials without including supplied values in errors', () => {
  for (const missing of ['SPACETRACK_IDENTITY', 'SPACETRACK_PASSWORD'] as const) {
    assert.throws(() => createLocalProxy({ ...env, [missing]: undefined }), (error: Error) => {
      assert.match(error.message, new RegExp(missing));
      assert.ok(!error.message.includes(env.SPACETRACK_IDENTITY));
      assert.ok(!error.message.includes(env.SPACETRACK_PASSWORD));
      return true;
    });
  }
});

test('loopback proxy uses environment credentials only upstream and rejects simple form posts', async () => {
  const calls: string[] = [];
  const server = createLocalProxy(env, async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith('/ajaxauth/login')) {
      assert.equal(init?.method, 'POST');
      assert.deepEqual(Object.fromEntries(init?.body as URLSearchParams), {
        identity: env.SPACETRACK_IDENTITY, password: env.SPACETRACK_PASSWORD,
      });
      return new Response(null, { headers: { 'Set-Cookie': 'session=fixture' } });
    }
    assert.equal(new Headers(init?.headers).get('Cookie'), 'session=fixture');
    return Response.json([vanguard]);
  });
  server.listen(0, LOCAL_PROXY_HOST);
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    assert.equal(address.address, '127.0.0.1');
    const base = `http://127.0.0.1:${address.port}`;
    const rejected = await fetch(`${base}/spacetrack/orbital`, { method: 'POST', body: '{"noradId":5}' });
    assert.equal(rejected.status, 415);
    assert.deepEqual(await rejected.json(), { error: 'Content-Type must be application/json' });
    assert.deepEqual(calls, []);

    const provider = new ProxyProvider('spacetrack', base);
    assert.deepEqual(await provider.getOrbitalData({ noradId: 5 }), [{ ...vanguard, EPOCH: `${vanguard.EPOCH}Z` }]);
    assert.deepEqual(calls, [
      'https://www.space-track.org/ajaxauth/login',
      'https://www.space-track.org/basicspacedata/query/class/gp/NORAD_CAT_ID/5/orderby/NORAD_CAT_ID/format/json',
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

for (const withSpaceTrack of [false, true]) {
  test(`local proxy supports N2YO ${withSpaceTrack ? 'alongside Space-Track' : 'without Space-Track credentials'}`, async () => {
    const key = 'fixture+api&key';
    const at = new Date((Math.floor(Date.now() / 1000) + 30) * 1000);
    const observer = { latitude: 1, longitude: 2, altitudeKm: 0.5 };
    const calls: string[] = [];
    const server = createLocalProxy({ ...(withSpaceTrack ? env : {}), N2YO_API_KEY: key }, async input => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/ajaxauth/login')) {
        return new Response(null, { headers: { 'Set-Cookie': 'session=fixture' } });
      }
      if (url.startsWith('https://www.space-track.org/')) return Response.json([vanguard]);
      assert.match(url, /^https:\/\/api\.n2yo\.com\/rest\/v1\/satellite\/positions\/25544\/1\/2\/500\/\d+\/\?apiKey=/);
      assert.equal(new URL(url).searchParams.get('apiKey'), key);
      return Response.json({ info: { satid: 25544 }, positions: [{
        timestamp: at.getTime() / 1000, satlatitude: 3, satlongitude: 4, sataltitude: 420,
      }] });
    });
    server.listen(0, LOCAL_PROXY_HOST);
    await once(server, 'listening');
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const base = `http://127.0.0.1:${address.port}`;
      const payload = { noradId: 25544, at: at.toISOString(), observer };
      assert.deepEqual(calls, []);
      const response = await fetch(`${base}/n2yo/validation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        noradId: 25544, timestamp: at.toISOString(), latitude: 3, longitude: 4, altitudeKm: 420,
      });
      const spaceTrack = await fetch(`${base}/spacetrack/orbital`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"noradId":5}',
      });
      assert.equal(spaceTrack.status, withSpaceTrack ? 200 : 404);
      assert.equal(calls.length, withSpaceTrack ? 3 : 1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
}
