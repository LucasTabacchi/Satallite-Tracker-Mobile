import test from 'node:test';
import assert from 'node:assert/strict';
import { predictPasses } from '../src/prediction';
import { parseElements, track, type Observer } from '../src/orbit';
import { vanguard } from './fixture';

const elements = parseElements(vanguard);
const observer: Observer = { latitude: 0, longitude: 0, altitudeKm: 0 };
const start = new Date('2000-06-27T18:50:19.733Z');

test('predicts crossing times and preserves geometric sky samples', async () => {
  const result = await predictPasses(elements, observer, {
    start, horizonHours: 3, minimumElevationDeg: 0, coarseStepSeconds: 120,
    refinementToleranceSeconds: 1, maxSamples: 500, maxPasses: 5,
  });
  assert.equal(result.visibilityKind, 'radio-geometric');
  assert.ok(result.windows.length > 0);
  const window = result.windows[0]!;
  assert.ok(window.aos && window.los);
  assert.ok(Math.abs(window.aos.elevationDeg) < 0.1);
  assert.ok(Math.abs(window.los.elevationDeg) < 0.1);
  assert.ok(window.maximum.elevationDeg >= window.samples[0]!.elevationDeg);
  assert.ok(window.samples.every(sample => Number.isFinite(sample.azimuthDeg) && Number.isFinite(sample.elevationDeg)));
});

test('honors cancellation, invalid limits and sample budget', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(predictPasses(elements, observer, { start, horizonHours: 1, signal: controller.signal }), /cancel/i);
  await assert.rejects(predictPasses(elements, observer, { start, horizonHours: 0 }), /horizon/i);
  await assert.rejects(predictPasses(elements, observer, { start, horizonHours: 24, coarseStepSeconds: 1, maxSamples: 10 }), /sample/i);
});

test('reports no-pass, elevated threshold, and visibility clipped at scan boundaries', async () => {
  const noPass = await predictPasses(elements, { latitude: 80, longitude: 0, altitudeKm: 0 }, {
    start, horizonHours: 3, coarseStepSeconds: 60, maxSamples: 500,
  });
  assert.deepEqual(noPass.windows, []);

  const baseline = await predictPasses(elements, observer, { start, horizonHours: 3, coarseStepSeconds: 60, maxSamples: 800 });
  assert.ok(baseline.windows.length > 0);
  const pass = baseline.windows[0]!;
  assert.ok(pass.aos && pass.los);
  const midpoint = pass.samples[Math.floor(pass.samples.length / 2)]!;
  const active = await predictPasses(elements, observer, {
    start: midpoint.at, horizonHours: 1 / 60, minimumElevationDeg: -1,
    coarseStepSeconds: 10, maxSamples: 50,
  });
  assert.equal(active.windows.length, 1);
  assert.equal(active.windows[0]!.aos, null);
  assert.equal(active.windows[0]!.los, null);
  assert.equal(active.windows[0]!.continuous, true);

  const elevated = await predictPasses(elements, observer, {
    start, horizonHours: 3, minimumElevationDeg: 10, coarseStepSeconds: 60, maxSamples: 1000,
  });
  assert.ok(elevated.windows.length <= baseline.windows.length);
  if (elevated.windows.length) assert.ok(elevated.windows[0]!.maximum.elevationDeg >= 10);
});

test('detects a narrow high-elevation pass peaking between coarse endpoints', async () => {
  const subpoint = track(elements, start, observer);
  const overheadObserver: Observer = { latitude: subpoint.latitude, longitude: subpoint.longitude, altitudeKm: 0 };
  const result = await predictPasses(elements, overheadObserver, {
    start: new Date(start.getTime() - 30_000), horizonHours: 1 / 60,
    minimumElevationDeg: 80, coarseStepSeconds: 60, refinementToleranceSeconds: 1,
    maxSamples: 100,
  });
  assert.equal(result.windows.length, 1);
  assert.ok(result.windows[0]!.aos && result.windows[0]!.los);
  assert.ok(Math.abs(result.windows[0]!.maximum.at.getTime() - start.getTime()) <= 1_000);
  assert.ok(result.windows[0]!.maximum.elevationDeg > 89);
});

test('rejects invalid observer and UTC time inputs instead of emitting invalid geometry', async () => {
  await assert.rejects(predictPasses(elements, { ...observer, latitude: 91 }, { start, horizonHours: 1 }), /observer/i);
  await assert.rejects(predictPasses(elements, observer, { start: new Date(Number.NaN), horizonHours: 1 }), /start time/i);
});
