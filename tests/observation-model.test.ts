import assert from 'node:assert/strict';
import test from 'node:test';
import { parseObserverForm, formatLocalDateTime, createSkyTrack } from '../src/ui/observation-model';
import { parseElements } from '../src/orbit';
import { projectSkyPosition } from '../src/geometry';
import { vanguard } from './fixture';
import type { PassWindow } from '../src/prediction';

test('observer form parsing delegates validation and converts altitude to kilometres', () => {
  assert.deepEqual(parseObserverForm({ latitude: '-34.6', longitude: '-58.4', altitudeMeters: '25' }), {
    latitude: -34.6, longitude: -58.4, altitudeKm: 0.025,
  });
  assert.throws(() => parseObserverForm({ latitude: '91', longitude: '0', altitudeMeters: '0' }), /coordinates/i);
});

test('local date/time formatting is explicit and readable', () => {
  const at = new Date('2026-11-03T15:04:00Z');
  for (const locale of [undefined, 'es-AR', 'en-US', 'en-GB']) {
    const value = formatLocalDateTime(at, locale);
    const expected = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(at);
    assert.equal(value, expected);
    assert.match(value, /2026/);
    assert.match(value, /\d{1,2}:\d{2}/);
    assert.doesNotMatch(value, /Invalid/);
  }
  assert.throws(() => formatLocalDateTime(new Date(NaN)), /Invalid date\/time/);
});

test('sky trajectory is north-up, deterministic, and bounded to one hundred samples', () => {
  const north = projectSkyPosition(0, 0), east = projectSkyPosition(90, 0);
  assert.ok(Math.abs(north.x) < 1e-12 && north.y === -1);
  assert.ok(east.x === 1 && Math.abs(east.y) < 1e-12);
  const elements = parseElements(vanguard);
  const observer = { latitude: -34, longitude: -58, altitudeKm: 0 };
  const start = new Date('2000-06-27T18:50:19.733Z');
  const pass: PassWindow = {
    aos: { at: start, azimuthDeg: 350, elevationDeg: 0 },
    maximum: { at: new Date(start.getTime() + 60_000), azimuthDeg: 0, elevationDeg: 45 },
    los: { at: new Date(start.getTime() + 120_000), azimuthDeg: 10, elevationDeg: 0 },
    samples: [], startsVisible: false, endsVisible: false, continuous: false,
  };
  const points = createSkyTrack(elements, observer, pass, 200);
  assert.equal(points.length, 100);
  assert.ok(points.every(point => Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1));
  assert.notDeepEqual(points[0], points.at(-1));
});
