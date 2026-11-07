import assert from 'node:assert/strict';
import test from 'node:test';
import { getHeadingGuidance, readDeviceObserver, readDeviceObserverFix, readLegacyAndroidAltitude, type DeviceLocationPort } from '../src/device';

test('reads a fresh observer only after foreground permission is granted', async () => {
  const calls: string[] = [];
  const port: DeviceLocationPort = {
    requestForegroundPermissions: async () => { calls.push('permission'); return { granted: true }; },
    getCurrentPosition: async () => { calls.push('position'); return { latitude: -34, longitude: -58, altitude: 20 }; },
  };
  assert.deepEqual(await readDeviceObserver(port), { latitude: -34, longitude: -58, altitudeKm: 0.02 });
  assert.deepEqual(calls, ['permission', 'position']);
});

test('does not request a position after foreground permission is denied', async () => {
  let requestedPosition = false;
  const port: DeviceLocationPort = {
    requestForegroundPermissions: async () => ({ granted: false }),
    getCurrentPosition: async () => { requestedPosition = true; return { latitude: 0, longitude: 0, altitude: 0 }; },
  };
  await assert.rejects(readDeviceObserver(port), /permission/i);
  assert.equal(requestedPosition, false);
});

test('stops waiting after 15 seconds and ignores a position that arrives after the deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let deliver!: (fix: { latitude: number; longitude: number; altitude: number }) => void;
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const port: DeviceLocationPort = {
    requestForegroundPermissions: async () => ({ granted: true }),
    getCurrentPosition: () => new Promise(resolve => { deliver = resolve; markStarted(); }),
  };
  const read = readDeviceObserver(port);
  const timeout = assert.rejects(read, { name: 'DeviceLocationTimeoutError' });
  await started;
  t.mock.timers.tick(15_000);
  deliver({ latitude: -34, longitude: -58, altitude: 20 });
  await timeout;
});

test('bounds a stalled permission response without starting a late location request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let grant!: (permission: { granted: boolean }) => void;
  let requests = 0;
  const read = readDeviceObserver({
    requestForegroundPermissions: () => new Promise(resolve => { grant = resolve; }),
    getCurrentPosition: async () => { requests++; return { latitude: 1, longitude: 2, altitude: 3 }; },
  });
  const timeout = assert.rejects(read, { name: 'DeviceLocationTimeoutError', phase: 'permission' });
  t.mock.timers.tick(20_000);
  grant({ granted: true });
  await timeout;
  assert.equal(requests, 0);
});

test('distinguishes a recent device fix from a current fix after acquisition fails', async () => {
  const fix = { latitude: -34, longitude: -58, altitude: 20, timestamp: Date.now() - 5_000, accuracy: 50 };
  assert.deepEqual(await readDeviceObserverFix({
    requestForegroundPermissions: async () => ({ granted: true }),
    getCurrentPosition: async () => { throw new Error('No current fix'); },
    getRecentPosition: async () => fix,
  }), { observer: { latitude: -34, longitude: -58, altitudeKm: 0.02 }, source: 'recent' });
});

test('does not use a cached location that is old, imprecise, or missing altitude', async () => {
  const fix = { latitude: -34, longitude: -58, altitude: 20, timestamp: Date.now() - 5_000, accuracy: 50 };
  for (const unsuitable of [{ ...fix, timestamp: Date.now() - 61_000 }, { ...fix, accuracy: 201 }, { ...fix, altitude: null }]) {
    await assert.rejects(readDeviceObserverFix({
      requestForegroundPermissions: async () => ({ granted: true }),
      getCurrentPosition: async () => { throw new Error('No current fix'); },
      getRecentPosition: async () => unsuitable,
    }), /No current fix/);
  }
});

test('rejects a fix with unknown altitude so callers can use manual location', async () => {
  const port: DeviceLocationPort = {
    requestForegroundPermissions: async () => ({ granted: true }),
    getCurrentPosition: async () => ({ latitude: -34, longitude: -58, altitude: null }),
  };
  await assert.rejects(readDeviceObserver(port), /altitude|manual/i);
});

test('does not mistake Android legacy zero defaults for a measured sea-level altitude', () => {
  assert.equal(readLegacyAndroidAltitude(0, 0), null);
  assert.equal(readLegacyAndroidAltitude(0, null), null);
  assert.equal(readLegacyAndroidAltitude(0, 12), 0);
  assert.equal(readLegacyAndroidAltitude(20, null), 20);
});

test('uses true heading only and returns the shortest signed turn with target elevation', () => {
  assert.deepEqual(getHeadingGuidance({ trueHeading: 359, accuracy: 1 }, 1, 25), {
    turnDegrees: 2, targetElevationDeg: 25,
  });
  assert.deepEqual(getHeadingGuidance({ trueHeading: 1, accuracy: 1 }, 359, 0), {
    turnDegrees: -2, targetElevationDeg: 0,
  });
  assert.throws(() => getHeadingGuidance({ trueHeading: -1, accuracy: 1 }, 90, 10), /heading/i);
  assert.throws(() => getHeadingGuidance({ trueHeading: 10, accuracy: 0 }, 90, 10), /accuracy/i);
});
