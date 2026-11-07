import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseElements, track } from '../src/orbit';
import { createDataService } from '../src/data-service';
import { comparePosition } from '../src/validation';
import { vanguard } from './fixture';

test('validation rejects mismatched provider identity and timestamp instead of inventing a comparison', async () => {
  const elements = parseElements(vanguard);
  const provider = { id: 'reference', capabilities: { catalog: false, orbital: false, validation: true },
    getCatalog: async () => [], getOrbitalData: async () => [], getValidationPosition: async () => ({ noradId: elements.NORAD_CAT_ID, timestamp: new Date(1), latitude: 0, longitude: 0, altitudeKm: 400 }) };
  const service = createDataService({ providers: [provider], storage: { getItem: async () => null, setItem: async () => {} }, now: () => Date.now() });
  await assert.rejects(service.validate(elements.NORAD_CAT_ID, new Date(2), { latitude: 0, longitude: 0, altitudeKm: 0 }, [elements]), /mismatched/);
});
test('aligned same-frame geodetic positions produce a zero-distance ECEF report row', () => {
  const elements = parseElements(vanguard), at = new Date(elements.EPOCH), observer = { latitude: -32.4, longitude: -58.2, altitudeKm: 0 };
  const local = track(elements, at, observer);
  const row = comparePosition(elements, { noradId: elements.NORAD_CAT_ID, timestamp: at, latitude: local.latitude, longitude: local.longitude, altitudeKm: local.altitudeKm }, at, observer, 'fixture', Date.now());
  assert.ok(row.errorKm < 1e-6);
  assert.equal(row.timestamp, at.toISOString());
  assert.equal(row.orbitalEpoch, elements.EPOCH);
});
