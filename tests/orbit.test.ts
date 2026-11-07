import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseElements, parseObserver, track } from '../src/orbit';
import { vanguard } from './fixture';

const at = new Date('2000-06-27T18:50:19.733Z');
const observer = { latitude: -32.4833, longitude: -58.2333, altitudeKm: 0.02 };

test('manual observer input requires explicit coordinates and converts meters to kilometers', () => {
  assert.deepEqual(parseObserver('-32.48', '-58.23', '20'), { latitude: -32.48, longitude: -58.23, altitudeKm: 0.02 });
  for (const values of [['', '', ''], ['91', '0', '0'], ['0', '181', '0'], ['NaN', '0', '0']]) {
    assert.throws(() => parseObserver(...values as [string, string, string]), /Invalid/);
  }
});

test('RF-02: matches the published Vallado TEME vector within 10 meters', () => {
  const result = track(parseElements(vanguard), at, observer);
  // https://github.com/aholinch/sgp4/blob/master/data/tcppver.out
  const expected = { x: 7022.46529266, y: -1400.08296755, z: 0.03995155 };
  for (const axis of ['x', 'y', 'z'] as const) {
    assert.ok(Math.abs(result.temeKm[axis] - expected[axis]) < 0.01);
  }
  assert.ok(Math.abs(result.latitude) <= 90);
  assert.ok(Math.abs(result.longitude) <= 180);
  assert.ok(result.altitudeKm > 600 && result.altitudeKm < 900);
});

test('RF-03: the satellite is at zenith from its subsatellite point', () => {
  const elements = parseElements(vanguard);
  const position = track(elements, at, observer);
  const result = track(elements, at, { ...position, altitudeKm: 0 });
  assert.ok(Math.abs(result.elevationDeg - 90) < 0.001);
  assert.ok(Math.abs(result.rangeKm - result.altitudeKm) < 0.001);
  assert.ok(result.azimuthDeg >= 0 && result.azimuthDeg < 360);
});

test('OMM: accepts six-digit NORAD IDs and treats unzoned epochs as UTC', () => {
  const elements = parseElements({ ...vanguard, NORAD_CAT_ID: 123456 });
  assert.equal(elements.NORAD_CAT_ID, 123456);
  assert.deepEqual(track(elements, at, observer), track(parseElements({ ...elements, EPOCH: `${vanguard.EPOCH}Z` }), at, observer));
});

test('invalid elements and observer coordinates cannot produce silent NaN telemetry', () => {
  for (const change of [{ MEAN_MOTION: 0 }, { ECCENTRICITY: 1 }, { EPOCH: 'invalid' }, { INCLINATION: NaN }, { BSTAR: null }]) {
    assert.throws(() => parseElements({ ...vanguard, ...change }), /Invalid/);
  }
  assert.throws(() => track(parseElements(vanguard), new Date('invalid'), observer), /Invalid/);
  assert.throws(() => track(parseElements(vanguard), at, { ...observer, latitude: 91 }), /Invalid/);
});
