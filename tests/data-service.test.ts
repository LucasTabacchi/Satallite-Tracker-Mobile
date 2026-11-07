import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseElements } from '../src/orbit';
import { createDataService, type DataProvider } from '../src/data-service';
import { UpstreamHttpError } from '../src/providers/http';
import { vanguard } from './fixture';

const valid = parseElements(vanguard);
function provider(id: string, result: Elements[] = [valid]): DataProvider {
  return { id, capabilities: { catalog: true, orbital: true, validation: false },
    getCatalog: async () => result, getOrbitalData: async () => result,
    getValidationPosition: async () => { throw new Error('unsupported'); } };
}
type Elements = ReturnType<typeof parseElements>;
test('catalog filters support names, groups, and six-digit NORAD IDs', async () => {
  const service = createDataService({ providers: [provider('one')], storage: { getItem: async () => null, setItem: async () => {} } });
  const response = await service.getCatalog({ group: 'stations', query: String(valid.NORAD_CAT_ID) });
  assert.equal(response.elements[0].NORAD_CAT_ID, valid.NORAD_CAT_ID);
});
test('provider failover returns the next capable provider result', async () => {
  const broken = provider('broken'); broken.getCatalog = async () => { throw new Error('offline'); };
  const service = createDataService({ providers: [broken, provider('backup')], storage: { getItem: async () => null, setItem: async () => {} } });
  assert.equal((await service.getCatalog()).provider, 'backup');
});

test('ignores old ISS-only cache entries for unrelated groups, whether fresh or stale', async () => {
  const clock = 20_000;
  const iss = parseElements({ ...vanguard, OBJECT_NAME: 'ISS', NORAD_CAT_ID: 25544 });
  const entries = new Map<string, string>();
  const key = (group: string, source: string, fetchedAt: number, elements: Elements[]) => {
    const identity = JSON.stringify({ op: 'orbital', group, noradId: null });
    const storageKey = 'satellite-tracker:data:v1:' + identity;
    entries.set(storageKey, JSON.stringify({ identity, fetchedAt, provider: source, elements }));
    return storageKey;
  };
  key('starlink', 'wheretheiss', clock - 1, [iss]);
  key('weather', 'wheretheiss', clock - 1001, [iss]);
  const validKey = key('gps-ops', 'celestrak', clock - 1, [valid]);
  const validCache = entries.get(validKey);
  const stationKey = key('stations', 'wheretheiss', clock - 1, [iss]);
  const stationCache = entries.get(stationKey);
  const primary = provider('celestrak');
  primary.getOrbitalData = async ({ group } = {}) => {
    if (group === 'starlink') return [valid];
    throw new Error('CelesTrak is unavailable');
  };
  const backup = provider('wheretheiss', [iss]);
  let backupCalls = 0;
  backup.getOrbitalData = async () => { backupCalls++; return [iss]; };
  const service = createDataService({ providers: [primary, backup], storage: {
    getItem: async storageKey => entries.get(storageKey) ?? null,
    setItem: async (storageKey, value) => { entries.set(storageKey, value); },
  }, now: () => clock, ttlMs: 1000, maxRetries: 0, rateLimits: { celestrak: [] } });
  const refreshed = await service.getOrbitalData({ group: 'starlink' });
  assert.equal(refreshed.source, 'network');
  assert.equal(refreshed.provider, 'celestrak');
  assert.equal(refreshed.elements[0]?.NORAD_CAT_ID, valid.NORAD_CAT_ID);
  await assert.rejects(service.getOrbitalData({ group: 'weather' }), /CelesTrak is unavailable/);
  const weatherKey = key('weather', 'celestrak', clock - 1001, [valid]);
  const weatherCache = entries.get(weatherKey);
  assert.equal((await service.getOrbitalData({ group: 'weather' })).source, 'stale-cache');
  assert.equal(entries.get(weatherKey), weatherCache);
  assert.equal((await service.getOrbitalData({ group: 'gps-ops' })).source, 'cache');
  assert.equal((await service.getOrbitalData({ group: 'stations' })).provider, 'wheretheiss');
  assert.equal(entries.get(validKey), validCache);
  assert.equal(entries.get(stationKey), stationCache);
  assert.equal(backupCalls, 0);
});
test('TTL boundary refreshes and keeps old cache intact until a validated success', async () => {
  let time = 1000, stored = '';
  const storage = { getItem: async () => stored || null, setItem: async (_key: string, value: string) => { stored = value; } };
  let calls = 0;
  const first = provider('first');
  const original = first.getCatalog;
  first.getCatalog = async q => { calls++; return calls === 1 ? original(q) : []; };
  const service = createDataService({ providers: [first], storage, now: () => time, ttlMs: 1000, maxRetries: 0 });
  const firstResult = await service.getCatalog();
  const bytesBefore = stored;
  assert.equal(firstResult.source, 'network');
  time = 1999;
  assert.equal((await service.getCatalog()).source, 'cache');
  time = 2000;
  assert.equal((await service.getCatalog()).source, 'stale-cache');
  assert.equal(stored, bytesBefore);
});
test('same-scope concurrent refreshes share one provider request', async () => {
  let calls = 0, release!: (value: typeof valid[]) => void;
  const delayed = new Promise<typeof valid[]>(resolve => { release = resolve; });
  const source = provider('slow'); source.getCatalog = async () => { calls++; return delayed; };
  const service = createDataService({ providers: [source], storage: { getItem: async () => null, setItem: async () => {} }, maxRetries: 0 });
  const one = service.getCatalog(), two = service.getCatalog();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  release([valid]);
  assert.deepEqual(await one, await two);
});
test('bounded retry and per-provider rolling window wait are deterministic', async () => {
  let time = 0, calls = 0;
  const delays: number[] = [];
  const source = provider('limited');
  source.getCatalog = async () => { calls++; if (calls === 1) throw new TypeError('temporary network failure'); return [valid]; };
  const service = createDataService({ providers: [source], storage: { getItem: async () => null, setItem: async () => {} }, now: () => time,
    sleep: async ms => { delays.push(ms); time += ms; }, retryBaseMs: 100, maxRetries: 1, rateLimits: { limited: { requests: 1, windowMs: 1000 } } });
  await service.getCatalog({ query: 'Vanguard' });
  await service.getCatalog({ query: 'Vanguard 1' });
  assert.deepEqual(delays, [100, 900, 1000]);
  assert.equal(calls, 3);
});
test('abort stops a refresh before reaching a provider', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const source = provider('abort'); source.getCatalog = async () => { calls++; return [valid]; };
  const service = createDataService({ providers: [source], storage: { getItem: async () => null, setItem: async () => {} }, maxRetries: 2 });
  await assert.rejects(service.getCatalog({ signal: controller.signal }));
  assert.equal(calls, 0);
});

test('catalog caches the raw group and applies each search locally', async () => {
  let calls = 0; const data = new Map<string, string>();
  const source = provider('raw');
  source.getCatalog = async () => { calls++; return [valid, parseElements({ ...vanguard, OBJECT_NAME: 'OTHER', NORAD_CAT_ID: 123456 })]; };
  const service = createDataService({ providers: [source], storage: { getItem: async key => data.get(key) ?? null, setItem: async (key, value) => { data.set(key, value); } } });
  assert.equal((await service.getCatalog({ group: 'stations', query: 'VANGUARD' })).elements.length, 1);
  const second = await service.getCatalog({ group: 'stations', query: 'OTHER' });
  assert.equal(second.elements[0].NORAD_CAT_ID, 123456);
  assert.equal(calls, 1);
});

test('empty catalog search is a valid result, not a provider failure', async () => {
  let calls = 0;
  const source = provider('empty'); source.getCatalog = async () => { calls++; return [valid]; };
  const service = createDataService({ providers: [source], storage: { getItem: async () => null, setItem: async () => {} }, maxRetries: 0 });
  const result = await service.getCatalog({ query: 'no such satellite' });
  assert.deepEqual(result.elements, []);
  assert.equal(result.provider, 'empty');
  assert.equal(calls, 1);
});

test('long quota waits are skipped in favor of fallback providers', async () => {
  const waits: number[] = [];
  let fallbackCalls = 0, now = 10, firstCalls = 0;
  const limited = provider('celestrak');
  const backup = provider('backup');
  limited.getCatalog = async () => { firstCalls++; return [valid]; };
  backup.getCatalog = async () => { fallbackCalls++; return [valid]; };
  const service = createDataService({ providers: [limited, backup], storage: { getItem: async () => null, setItem: async () => {} },
    now: () => now, sleep: async ms => { waits.push(ms); now += ms; }, maxRetries: 0, maxWaitMs: 20, ttlMs: 1 });
  await service.getCatalog();
  now += 2;
  await service.getCatalog();
  assert.equal(firstCalls, 1);
  assert.equal(fallbackCalls, 1);
  assert.ok(waits.every(ms => ms <= 20));
});

test('validation abort is propagated to orbital loading and ISS-only validators are skipped for other IDs', async () => {
  const controller = new AbortController(); controller.abort();
  let orbitalCalls = 0, validationCalls = 0;
  const source = provider('source'); source.getOrbitalData = async q => { orbitalCalls++; assert.equal(q?.signal, controller.signal); return [valid]; };
  const iss = provider('wheretheiss'); iss.capabilities.validation = true;
  iss.getValidationPosition = async () => { validationCalls++; throw new Error('ISS-only provider should be skipped'); };
  const other = provider('other'); other.capabilities.validation = true;
  other.getValidationPosition = async q => ({ noradId: q.noradId, timestamp: q.at, latitude: 0, longitude: 0, altitudeKm: 420 });
  const service = createDataService({ providers: [source, iss, other], storage: { getItem: async () => null, setItem: async () => {} }, maxRetries: 0 });
  await assert.rejects(service.validate(valid.NORAD_CAT_ID, new Date(), { latitude: 0, longitude: 0, altitudeKm: 0 }, undefined, controller.signal));
  assert.equal(orbitalCalls, 0);
  const rows = await service.validate(123456, new Date(), { latitude: 0, longitude: 0, altitudeKm: 0 }, [parseElements({ ...vanguard, NORAD_CAT_ID: 123456 })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, 'other');
  assert.equal(validationCalls, 0);
});

test('invalid numeric options are rejected instead of clamped', () => {
  const base = { providers: [], storage: { getItem: async () => null, setItem: async () => {} } };
  assert.throws(() => createDataService({ ...base, ttlMs: Number.NaN }), /Invalid service options/);
  assert.throws(() => createDataService({ ...base, maxRetries: -1 }), /Invalid service options/);
  assert.throws(() => createDataService({ ...base, maxWaitMs: Number.POSITIVE_INFINITY }), /Invalid service options/);
});

test('one singleflight waiter can abort without cancelling another waiter', async () => {
  let release!: (rows: typeof valid[]) => void, providerSignal: AbortSignal | undefined;
  const source = provider('shared'); source.getCatalog = async q => { providerSignal = q?.signal; return new Promise(resolve => { release = resolve; }); };
  const service = createDataService({ providers: [source], storage: { getItem: async () => null, setItem: async () => {} }, maxRetries: 0 });
  const controller = new AbortController();
  const abandoned = service.getCatalog({ signal: controller.signal });
  const remaining = service.getCatalog();
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(abandoned, { name: 'AbortError' });
  assert.equal(providerSignal?.aborted, false);
  release([valid]);
  assert.equal((await remaining).elements.length, 1);
});

test('last waiter abort abandons a flight without persisting its late response', async () => {
  const releases: Array<(rows: typeof valid[]) => void> = []; let calls = 0, writes = 0;
  const source = provider('abandoned'); source.getCatalog = async () => { calls++; return new Promise(resolve => { releases.push(resolve); }); };
  const service = createDataService({ providers: [source], storage: { getItem: async () => null, setItem: async () => { writes++; } }, maxRetries: 0 });
  const controller = new AbortController();
  const abandoned = service.getCatalog({ signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(abandoned, { name: 'AbortError' });
  const replacement = service.getCatalog();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 2);
  releases[0]([valid]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(writes, 0);
  releases[1]([valid]);
  assert.equal((await replacement).elements.length, 1);
  assert.equal(writes, 1);
});

test('permanent HTTP status is not retried', async () => {
  let calls = 0;
  const source = provider('permanent'); source.getCatalog = async () => { calls++; throw Object.assign(new Error('bad request'), { status: 400 }); };
  const service = createDataService({ providers: [source], storage: { getItem: async () => null, setItem: async () => {} }, maxRetries: 3 });
  await assert.rejects(service.getCatalog());
  assert.equal(calls, 1);
});

test('Starlink 403 pauses downloads across service restarts without blocking other groups', async () => {
  const twoHours = 2 * 60 * 60 * 1000;
  for (const retryAfter of [undefined, 3 * 60 * 60 * 1000]) {
    let now = 1000, requests = 0;
    const persisted = new Map<string, string>();
    const primary = provider('celestrak');
    primary.getOrbitalData = async ({ group, noradId } = {}) => {
      if (group === 'starlink' && noradId === undefined && ++requests === 1) throw new UpstreamHttpError(403, retryAfter);
      return [valid];
    };
    primary.getCatalog = async () => { requests++; return [valid]; };
    const create = () => createDataService({ providers: [primary], storage: {
      getItem: async key => persisted.get(key) ?? null,
      setItem: async (key, value) => { persisted.set(key, value); },
    }, now: () => now, rateLimits: { celestrak: [] } });
    const expectedUntil = now + (retryAfter ?? twoHours);
    const matchesPause = { name: 'StarlinkDownloadPausedError', retryAt: expectedUntil };
    await assert.rejects(create().getOrbitalData({ group: 'starlink' }), matchesPause);
    const restarted = create();
    assert.equal((await restarted.getOrbitalData({ group: 'weather' })).source, 'network');
    now = expectedUntil - 1;
    await assert.rejects(restarted.getOrbitalData({ group: 'starlink' }), matchesPause);
    await assert.rejects(restarted.getCatalog({ group: 'starlink', noradId: valid.NORAD_CAT_ID }), matchesPause);
    assert.equal((await restarted.getOrbitalData({ group: 'starlink', noradId: valid.NORAD_CAT_ID })).source, 'network');
    assert.equal(requests, 1);
    now = expectedUntil;
    assert.equal((await restarted.getOrbitalData({ group: 'starlink' })).source, 'network');
    assert.equal(requests, 2);
  }
});

test('keeps a valid Starlink cache usable after a 403 without requerying on restart', async () => {
  let now = 1000, requests = 0;
  const persisted = new Map<string, string>();
  const primary = provider('celestrak');
  primary.getOrbitalData = async () => {
    if (++requests > 1) throw new UpstreamHttpError(403);
    return [valid];
  };
  const create = () => createDataService({ providers: [primary], storage: {
    getItem: async key => persisted.get(key) ?? null,
    setItem: async (key, value) => { persisted.set(key, value); },
  }, now: () => now, ttlMs: 100, rateLimits: { celestrak: [] } });
  const original = create();
  await original.getOrbitalData({ group: 'starlink' });
  now += 100;
  assert.equal((await original.getOrbitalData({ group: 'starlink' })).source, 'stale-cache');
  assert.equal((await create().getOrbitalData({ group: 'starlink' })).source, 'stale-cache');
  assert.equal(requests, 2);
});

test('429 retries honor Retry-After while delays beyond the bound fail over immediately', async () => {
  let calls = 0; const delays: number[] = [];
  const limited = provider('throttled'); limited.getCatalog = async () => { calls++; if (calls === 1) throw Object.assign(new Error('throttled'), { status: 429, retryAfterMs: 100 }); return [valid]; };
  const service = createDataService({ providers: [limited], storage: { getItem: async () => null, setItem: async () => {} }, maxRetries: 1, retryBaseMs: 1, maxWaitMs: 100, sleep: async ms => { delays.push(ms); } });
  await service.getCatalog();
  assert.equal(calls, 2);
  assert.deepEqual(delays, [100]);

  let fallbackCalls = 0;
  const tooLong = provider('too-long'); tooLong.getCatalog = async () => { throw Object.assign(new Error('throttled'), { status: 429, retryAfterMs: 5000 }); };
  const fallback = provider('fallback'); fallback.getCatalog = async () => { fallbackCalls++; return [valid]; };
  const bounded = createDataService({ providers: [tooLong, fallback], storage: { getItem: async () => null, setItem: async () => {} }, maxRetries: 3, maxWaitMs: 20, sleep: async ms => { delays.push(ms); } });
  assert.equal((await bounded.getCatalog()).provider, 'fallback');
  assert.equal(fallbackCalls, 1);
  assert.deepEqual(delays, [100]);
});
