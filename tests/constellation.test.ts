import test from 'node:test';
import assert from 'node:assert/strict';
import { propagateConstellation } from '../src/constellation';
import { parseElements, type Elements, type Observer } from '../src/orbit';
import { vanguard } from './fixture';

const valid = parseElements(vanguard);
const observer: Observer = { latitude: 35, longitude: -75, altitudeKm: 0 };
const epoch = new Date('2000-06-27T18:50:19.733Z');

test('preserves input order while isolating per-satellite propagation failures', async () => {
  const invalid = { ...valid, MEAN_MOTION: -1 } as Elements;
  const result = await propagateConstellation([valid, invalid, valid], observer, epoch, { maxObjects: 3, batchSize: 1 });
  assert.deepEqual(result.positions.map(item => item.index), [0, 2]);
  assert.deepEqual(result.failures.map(item => item.index), [1]);
  assert.equal(result.positions[0]!.noradId, valid.NORAD_CAT_ID);
});

test('enforces explicit object bounds and cooperative cancellation', async () => {
  await assert.rejects(propagateConstellation([valid, valid], observer, epoch, { maxObjects: 1 }), /limit/i);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(propagateConstellation([valid], observer, epoch, { signal: controller.signal }), /cancel/i);
});
