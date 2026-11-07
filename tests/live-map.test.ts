import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveFrame, createLiveMapController, createBrowserLoader, projectCoordinate, UPDATE_MS } from '../design/live-map';
import { parseElements, track } from '../src/orbit';
import type { DataResult } from '../src/data-service';
import { vanguard } from './fixture';

const epoch = Date.parse('2000-06-27T18:50:19.733Z');
const data = (id = 25544, fetchedAt = epoch): DataResult => ({ elements: [parseElements({ ...vanguard, NORAD_CAT_ID: id })], fetchedAt, elementEpoch: vanguard.EPOCH, provider: 'celestrak', source: 'network', ageMs: 0 });
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(load = async (id: number, _signal: AbortSignal) => data(id)) {
  let now = epoch;
  const events: any[] = [];
  const timers = new Map<number, () => void>();
  let next = 0;
  const controller = createLiveMapController({ load, now: () => now, emit: (value: any) => events.push(value),
    setTimer: (fn: () => void, delay: number) => { assert.equal(delay, UPDATE_MS); timers.set(++next, fn); return next; },
    clearTimer: (id: number) => timers.delete(id),
  });
  return { controller, events, timers, advance(ms = UPDATE_MS) { now += ms; [...timers.values()].forEach(fn => fn()); } };
}

test('live frame uses shared SGP4 coordinates and equirectangular projection', () => {
  const at = new Date(epoch);
  const frame = buildLiveFrame(data(), at);
  assert.ok(frame, 'Expected an SGP4 frame, not preview coordinates');
  const expected = track(data().elements[0], at, { latitude: -34.6037, longitude: -58.3816, altitudeKm: .025 });
  assert.equal(frame.position.latitude, expected.latitude);
  assert.equal(frame.position.longitude, expected.longitude);
  assert.deepEqual(frame.point, projectCoordinate(expected.latitude, expected.longitude));
  assert.deepEqual(projectCoordinate(0, 0), { x: 500, y: 275 });
  assert.deepEqual(projectCoordinate(90, -180), { x: 0, y: 0 });
  assert.equal(frame.periodMinutes, 1440 / Number(data().elements[0].MEAN_MOTION));
  assert.ok(frame.speedKmS > 0);
  assert.notDeepEqual(buildLiveFrame(data(), new Date(epoch + 2000)).point, frame.point);
  assert.ok(frame.groundTrack.segments.length > 0);
  for (const segment of frame.groundTrack.segments) for (let i = 1; i < segment.length; i++) {
    assert.ok(Math.abs(segment[i].longitude - segment[i - 1].longitude) <= 180);
  }
});

test('controller propagates every two seconds without network polling and pauses cleanly', async () => {
  let calls = 0;
  const h = harness(async id => { calls++; return data(id); });
  h.controller.select(25544);
  h.controller.setActive(true);
  await flush();
  assert.equal(h.timers.size, 1);
  const first = h.events.at(-1);
  assert.equal(first.status, 'ready');
  h.advance(); h.advance();
  assert.notDeepEqual(h.events.at(-1).frame.point, first.frame.point);
  assert.equal(calls, 1);
  h.controller.setActive(false);
  assert.equal(h.timers.size, 0);
  const count = h.events.length;
  h.advance(60000);
  assert.equal(h.events.length, count);
  h.controller.setActive(true);
  await flush();
  assert.equal(h.timers.size, 1);
  assert.equal(calls, 1);
  h.controller.dispose();
  assert.equal(h.timers.size, 0);
});

test('late selection and disposed fetches never publish a stale satellite', async () => {
  const pending = new Map<number, { resolve: (value: DataResult) => void; signal: AbortSignal }>();
  const h = harness((id, signal) => new Promise(resolve => pending.set(id, { resolve, signal })));
  h.controller.select(25544); h.controller.setActive(true);
  h.controller.select(20580);
  assert.equal(pending.get(25544)?.signal.aborted, true);
  pending.get(20580)!.resolve(data(20580)); await flush();
  pending.get(25544)!.resolve(data()); await flush();
  assert.equal(h.events.at(-1).frame.noradId, 20580);
  h.controller.select(48274); const length = h.events.length;
  h.controller.dispose(); pending.get(48274)!.resolve(data(48274)); await flush();
  assert.equal(h.events.length, length);
  assert.equal(h.timers.size, 0);
});

test('provider failures and mismatched IDs never emit a ready sample position', async () => {
  for (const load of [async () => { throw new Error('offline'); }, async () => data(20580)]) {
    const h = harness(load);
    h.controller.select(25544); h.controller.setActive(true); await flush();
    assert.equal(h.events.at(-1)?.status, 'error');
    assert.ok(!h.events.some(event => event.status === 'ready'));
    h.controller.dispose();
  }
});

test('epoch age and stale cache are explicit; refresh is bounded after TTL', async () => {
  let calls = 0;
  const h = harness(async id => { calls++; return { ...data(id), source: 'stale-cache' }; });
  h.controller.select(25544); h.controller.setActive(true); await flush();
  assert.equal(h.events.at(-1)?.frame.source, 'stale-cache');
  h.advance(86400000 + 2000); await flush();
  assert.equal(calls, 2);
  h.advance(); await flush();
  assert.equal(calls, 2);
  assert.ok(h.events.at(-1).frame.epochAgeMs >= 86400000);
  h.controller.dispose();
});

test('browser loader shares existing persistent cache, fetches only selected IDs and stops HTTP retries', async () => {
  const values = new Map<string, string>();
  const storage = { async getItem(key: string) { return values.get(key) ?? null; }, async setItem(key: string, value: string) { values.set(key, value); } };
  const calls: number[] = [];
  const request: typeof fetch = async (url, init) => {
    assert.equal(init?.redirect, 'error');
    const id = Number(new URL(String(url)).searchParams.get('CATNR')); calls.push(id);
    return new Response(JSON.stringify(data(id).elements));
  };
  const load = createBrowserLoader(storage, request), signal = new AbortController().signal;
  await load(25544, signal); await load(20580, signal);
  assert.equal((await load(25544, signal)).source, 'cache');
  assert.deepEqual(calls, [25544, 20580]);
  await assert.rejects(load(123, signal), /catalog/);
  assert.deepEqual(calls, [25544, 20580]);
  const before = JSON.stringify([...values]);
  const reloaded = createBrowserLoader(storage, async () => { throw new Error('No network expected'); });
  assert.equal((await reloaded(20580, signal)).source, 'cache');
  assert.equal(JSON.stringify([...values]), before);
  let failures = 0;
  const failing = createBrowserLoader(storage, async () => { failures++; return new Response('', { status: 503 }); });
  await assert.rejects(failing(48274, signal));
  await assert.rejects(failing(48274, signal));
  assert.equal(failures, 1);
});
