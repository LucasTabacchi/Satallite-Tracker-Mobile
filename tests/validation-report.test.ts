import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseElements, track } from '../src/orbit';
import { buildValidationEvidence, renderValidationReport } from '../src/validation-report';
import { vanguard } from './fixture';

test('report preserves exact timestamps, orbital age and numerical errors without declaring live acceptance', () => {
  const element = parseElements(vanguard);
  const at = new Date(element.EPOCH);
  const local = track(element, at, { latitude: 0, longitude: 0, altitudeKm: 0 });
  const reference = { noradId: element.NORAD_CAT_ID, timestamp: at, latitude: local.latitude, longitude: local.longitude, altitudeKm: local.altitudeKm + 1 };
  const evidence = buildValidationEvidence(element, [reference], 'test-reference', new Date(+at + 3_600_000));
  assert.ok(Math.abs(evidence.rows[0].errorKm - 1) < 1e-6);
  assert.equal(evidence.rows[0].timestamp, at.toISOString());
  assert.equal(evidence.rows[0].orbitalAgeMs, 3_600_000);
  assert.deepEqual(evidence.references, [reference]);
  const report = renderValidationReport([evidence]);
  assert.match(report, /test-reference/);
  assert.match(report, /1\.000000/);
  assert.match(report, /N2YO.*not collected/);
  assert.match(report, /not a physical-device/);
});

test('empty and mismatched evidence is rejected instead of manufacturing a successful report', () => {
  const element = parseElements(vanguard);
  assert.throws(() => buildValidationEvidence(element, [], 'test-reference', new Date()), /No reference/);
  assert.throws(() => buildValidationEvidence(element, [{ noradId: 99999, timestamp: new Date(element.EPOCH), latitude: 0, longitude: 0, altitudeKm: 1 }], 'test-reference', new Date()), /mismatched/);
  assert.throws(() => renderValidationReport([]), /No evidence/);
});
