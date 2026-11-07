import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFootprint, generateGroundTrack, projectSkyPosition } from '../src/geometry';
import { parseElements } from '../src/orbit';
import { vanguard } from './fixture';

const elements = parseElements(vanguard);
const epoch = new Date('2000-06-27T18:50:19.733Z');

test('generates at least one orbit and splits the antimeridian', () => {
  const result = generateGroundTrack(elements, epoch, { stepSeconds: 45, maxSamples: 2500 });
  const period = 86400 / Number(elements.MEAN_MOTION);
  assert.ok(result.end.getTime() - result.start.getTime() >= period * 1000);
  assert.ok(result.samples.length <= 2500);
  assert.ok(result.segments.length >= 2);
  for (const segment of result.segments) {
    for (let i = 1; i < segment.length; i++) assert.ok(Math.abs(segment[i]!.longitude - segment[i - 1]!.longitude) <= 180);
  }
});

test('calculates bounded spherical footprints and stable polar orientation', () => {
  const near = calculateFootprint(400, 5, 36);
  const far = calculateFootprint(400, 10, 36, 1);
  assert.ok(near.angularRadiusDeg > 0 && near.angularRadiusDeg < 90);
  assert.ok(near.angularRadiusDeg > far.angularRadiusDeg);
  assert.ok(near.coordinates.every(point => point.latitude >= -90 && point.latitude <= 90 && point.longitude >= -180 && point.longitude <= 180));
  assert.deepEqual(projectSkyPosition(0, 0), { x: 0, y: -1, radius: 1 });
  assert.ok(Math.abs(projectSkyPosition(90, 45).x - 0.5) < 1e-12);
});

test('rejects invalid geometry inputs and undersized sample budgets', () => {
  assert.throws(() => generateGroundTrack(elements, epoch, { stepSeconds: 30, maxSamples: 10 }), /sample/i);
  assert.throws(() => calculateFootprint(-1, 0, 36), /altitude/i);
  assert.throws(() => projectSkyPosition(361, 20), /azimuth/i);
});
