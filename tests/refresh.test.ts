import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshCoordinator, type RefreshSettings } from '../src/refresh';
import { parseElements } from '../src/orbit';
import type { PassWindow } from '../src/prediction';
import { vanguard } from './fixture';

const now = new Date('2000-06-28T00:00:00Z');
const settings: RefreshSettings = {
  observer: { latitude: 0, longitude: 0, altitudeKm: 0 },
  noradIds: [5], group: 'stations', leadMinutes: 10, minimumElevationDeg: 5,
};
function fixture() {
  let saved: string | null = null;
  const effects: string[] = [];
  let calls = 0;
  const aos = { at: new Date(now.getTime() + 3600_000), azimuthDeg: 0, elevationDeg: 5 };
  const pass: PassWindow = { aos, los: null, maximum: aos, samples: [aos], startsVisible: false, endsVisible: true, continuous: false };
  const coordinator = createRefreshCoordinator({
    storage: { getItem: async () => saved, setItem: async (_key, value) => { saved = value; } },
    data: { getOrbitalData: async () => {
      calls++;
      return { elements: [parseElements(vanguard)], source: 'cache', fetchedAt: now.getTime(), ageMs: 0, elementEpoch: vanguard.EPOCH, provider: 'fixture' };
    } },
    scheduler: { reconcile: async reminders => { effects.push(`schedule:${reminders.length}`); } },
    background: { register: async () => { effects.push('register'); }, unregister: async () => { effects.push('unregister'); } },
    now: () => now, predict: async () => [pass],
  });
  return { coordinator, effects, calls: () => calls, saved: () => saved, corrupt: () => { saved = '{'; } };
}

test('disabled refresh does not load data or schedule notifications', async () => {
  const f = fixture();
  assert.deepEqual(await f.coordinator.refresh(), { status: 'disabled', reminderCount: 0, warnings: [] });
  assert.equal(f.calls(), 0);
  assert.deepEqual(f.effects, []);
});

test('configured refresh persists settings, predicts and reconciles reminders', async () => {
  const f = fixture();
  await f.coordinator.configure(settings);
  assert.equal(JSON.parse(f.saved()!).version, 1);
  assert.deepEqual(f.effects, ['register']);
  assert.deepEqual(await f.coordinator.refresh(), { status: 'updated', reminderCount: 1, warnings: [] });
  assert.equal(f.calls(), 1);
  assert.deepEqual(f.effects, ['register', 'schedule:1']);
});

test('invalid configuration does not overwrite settings or register work', async () => {
  const f = fixture();
  for (const invalid of [
    { ...settings, noradIds: [5, 5] }, { ...settings, noradIds: [] },
    { ...settings, leadMinutes: NaN }, { ...settings, group: 'unknown' },
    { ...settings, observer: { ...settings.observer, latitude: 100 } },
  ]) await assert.rejects(f.coordinator.configure(invalid as RefreshSettings), /Invalid|Unsupported/);
  assert.equal(f.saved(), null);
  assert.deepEqual(f.effects, []);
});

test('disable cancels owned reminders and unregisters; following refresh stays idle', async () => {
  const f = fixture();
  await f.coordinator.configure(settings);
  await f.coordinator.configure(null);
  assert.deepEqual(f.effects, ['register', 'schedule:0', 'unregister']);
  assert.equal((await f.coordinator.refresh()).status, 'disabled');
  assert.equal(f.calls(), 0);
});

test('corrupt settings fail closed without network or notification changes', async () => {
  const f = fixture(); f.corrupt();
  await assert.rejects(f.coordinator.refresh(), /Invalid refresh settings/);
  assert.equal(f.calls(), 0);
  assert.deepEqual(f.effects, []);
});

test('aborted refresh preserves scheduled reminders', async () => {
  const f = fixture(); await f.coordinator.configure(settings);
  const signal = AbortSignal.abort();
  await assert.rejects(f.coordinator.refresh(signal));
  assert.equal(f.calls(), 0);
  assert.deepEqual(f.effects, ['register']);
});
