import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationController, type ApplicationControllerDependencies } from '../src/application/controller';
import { vanguard } from './fixture';

test('late reminder enable cannot replace newer cancellation state', async () => {
  let finish!: () => void;
  const { deps } = setup({ reminders: { enable: () => new Promise<void>(resolve => { finish = resolve; }), disable: async () => {} } });
  const app = createApplicationController(deps);
  await app.initialize();
  await app.selectSatellite(vanguard.NORAD_CAT_ID);
  app.setObserver({ latitude: 0, longitude: 0, altitudeKm: 0 });
  const enabling = app.enableReminders();
  await app.disableReminders();
  finish();
  await enabling;
  assert.equal(app.getState().remindersEnabled, false);
  assert.equal(app.getState().reminderError, undefined);
  app.dispose();
});
import type { CatalogQuery } from '../src/providers/types';

function setup(overrides: Partial<ApplicationControllerDependencies> = {}) {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const timers: Array<{ callback: () => void; ms: number; cleared: boolean }> = [];
  const deps: ApplicationControllerDependencies = {
    storage: { getItem: async key => store.get(key) ?? null, setItem: async (key, value) => { store.set(key, value); } },
    data: {
      getCatalog: async (query?: CatalogQuery) => { calls.push(`catalog:${query?.group}`); return { elements: [vanguard], fetchedAt: 10_000, elementEpoch: vanguard.EPOCH, provider: 'test', source: 'network', ageMs: 0 }; },
      getOrbitalData: async (query?: CatalogQuery) => { calls.push(`orbital:${query?.noradId}`); return { elements: [vanguard], fetchedAt: 10_000, elementEpoch: vanguard.EPOCH, provider: 'test', source: 'network', ageMs: 0 }; },
      validate: async (id: number, at: Date) => { calls.push(`validate:${id}:${at.toISOString()}`); return []; },
    } as unknown as ApplicationControllerDependencies['data'],
    now: () => 10_000,
    setInterval: ((callback: () => void, ms: number) => { calls.push(`timer:${ms}`); const timer = { callback, ms, cleared: false }; timers.push(timer); return timer as unknown as ReturnType<typeof setInterval>; }) as typeof setInterval,
    clearInterval: ((timer: unknown) => { calls.push('clear'); const found = timer as { cleared: boolean }; found.cleared = true; }) as typeof clearInterval,
    reminders: { enable: async () => undefined, disable: async () => undefined },
    ...overrides,
  };
  return { store, calls, timers, deps };
}

test('initializes with no synthetic observer and uses 2-second local propagation without refetching', async () => {
  const { deps, calls, timers } = setup();
  const app = createApplicationController(deps);
  await app.initialize();
  await app.selectSatellite(vanguard.NORAD_CAT_ID);
  app.setActive(true);
  assert.equal(app.getState().observer, undefined);
  assert.equal(app.getState().catalog.length, 1);
  assert.ok(app.getState().position);
  assert.ok(calls.includes('timer:2000'));
  assert.ok(calls.includes('timer:86400000'));
  assert.deepEqual(calls.filter(call => call.startsWith('orbital:')), ['orbital:undefined']);
  app.dispose();
});

test('keeps prior group selection cleared and ignores stale catalog completion', async () => {
  let resolveStations!: (value: { elements: typeof vanguard[]; fetchedAt: number; elementEpoch: string; provider: string; source: 'network'; ageMs: number }) => void;
  const first = new Promise<any>(resolve => { resolveStations = resolve; });
  const { deps } = setup({ data: {
    getCatalog: (query?: CatalogQuery) => query?.group === 'stations' ? first : Promise.resolve({ elements: [vanguard], fetchedAt: 10000, elementEpoch: vanguard.EPOCH, provider: 'test', source: 'network', ageMs: 0 }),
    getOrbitalData: async () => ({ elements: [vanguard], fetchedAt: 10000, elementEpoch: vanguard.EPOCH, provider: 'test', source: 'network', ageMs: 0 }),
    validate: async () => [],
  } as unknown as ApplicationControllerDependencies['data'] });
  const app = createApplicationController(deps);
  const oldLoad = app.initialize();
  await app.selectGroup('starlink');
  resolveStations({ elements: [vanguard], fetchedAt: 10000, elementEpoch: vanguard.EPOCH, provider: 'test', source: 'network', ageMs: 0 });
  await oldLoad;
  assert.equal(app.getState().group, 'starlink');
  assert.equal(app.getState().catalog.length, 1);
  app.dispose();
});

test('restores validated versioned preferences but never invents location', async () => {
  const { deps, store } = setup();
  store.set('satellite-tracker:application:v1', JSON.stringify({ version: 1, group: 'gps-ops', selectedNoradId: 123, observer: null, minimumElevationDeg: 12, leadMinutes: 8 }));
  const app = createApplicationController(deps);
  await app.initialize();
  assert.equal(app.getState().group, 'gps-ops');
  assert.equal(app.getState().observer, undefined);
  assert.equal(app.getState().minimumElevationDeg, 12);
  assert.equal(app.getState().leadMinutes, 8);
  app.dispose();
});

test('validation is explicit, timestamp is second-normalized, and local observer fallback is labeled', async () => {
  const { deps, calls } = setup({ now: () => 12_345 });
  const app = createApplicationController(deps);
  await app.initialize();
  await app.selectSatellite(vanguard.NORAD_CAT_ID);
  await app.validateSelected();
  assert.ok(calls.includes('validate:5:1970-01-01T00:00:12.000Z'));
  assert.equal(app.getState().validationObserverSource, 'calculation-origin');
  assert.equal(app.getState().validationStatus, 'success');
  app.dispose();
});

test('reminder state changes only after native operation succeeds', async () => {
  const { deps } = setup({ reminders: { enable: async () => { throw new Error('permission denied'); }, disable: async () => undefined } });
  const app = createApplicationController(deps);
  await app.initialize();
  app.setObserver({ latitude: 0, longitude: 0, altitudeKm: 0 });
  await assert.rejects(app.enableReminders(), /permission denied/);
  assert.equal(app.getState().remindersEnabled, false);
  app.dispose();
});

test('selection cancels stale validation results and dispose releases local timers', async () => {
  let resolveValidation!: (rows: []) => void;
  const { deps, calls } = setup({ data: {
    getCatalog: async () => ({ elements: [vanguard], fetchedAt: 10000, elementEpoch: vanguard.EPOCH, provider: 'test', source: 'network', ageMs: 0 }),
    getOrbitalData: async () => ({ elements: [vanguard], fetchedAt: 10000, elementEpoch: vanguard.EPOCH, provider: 'test', source: 'network', ageMs: 0 }),
    validate: async () => new Promise<[]>(resolve => { resolveValidation = resolve; }),
  } as unknown as ApplicationControllerDependencies['data'] });
  const app = createApplicationController(deps);
  await app.initialize();
  await app.selectSatellite(vanguard.NORAD_CAT_ID);
  app.setActive(true);
  const pending = app.validateSelected();
  await app.selectSatellite(null);
  resolveValidation([]);
  await pending;
  assert.equal(app.getState().selectedNoradId, undefined);
  assert.equal(app.getState().validationStatus, 'idle');
  app.dispose();
  assert.ok(calls.includes('clear'));
});

test('selecting a satellite leaves the bounded catalog TTL refresh armed', async () => {
  const { deps, calls, timers } = setup();
  const app = createApplicationController(deps);
  await app.initialize();
  app.setActive(true);
  await app.selectSatellite(vanguard.NORAD_CAT_ID);
  assert.ok(calls.includes('timer:86400000'));
  assert.ok(timers.some(timer => timer.ms === 86_400_000 && !timer.cleared));
  app.dispose();
});

test('observer removal prevents an in-flight pass prediction from repopulating passes', async () => {
  let resolvePrediction!: (value: any) => void;
  const { deps } = setup({ predict: async () => new Promise(resolve => { resolvePrediction = resolve; }) as any });
  const app = createApplicationController(deps);
  await app.initialize();
  await app.selectSatellite(vanguard.NORAD_CAT_ID);
  app.setObserver({ latitude: 10, longitude: 20, altitudeKm: 0 });
  app.clearObserver();
  resolvePrediction({ visibilityKind: 'radio-geometric', start: new Date(0), end: new Date(1), windows: [], sampleCount: 0 });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.getState().observer, undefined);
  assert.equal(app.getState().passes, undefined);
  app.dispose();
});

test('enabled constellation layer refreshes locally while active and selection preserves its enabled state', async () => {
  const { deps, calls, timers } = setup();
  const app = createApplicationController(deps);
  await app.initialize();
  app.setActive(true);
  app.setConstellationEnabled(true, 1);
  const tick = timers.filter(timer => timer.ms === 2000).at(-1)?.callback;
  assert.ok(calls.includes('timer:2000'));
  tick?.();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(app.getState().constellation);
  await app.selectSatellite(vanguard.NORAD_CAT_ID);
  assert.equal(app.getState().constellationEnabled, true);
  app.dispose();
});

test('validation action can request only its corresponding reference provider', async () => {
  let requestedProvider: string | undefined;
  const { deps } = setup({ data: {
    getCatalog: async () => ({ elements: [vanguard], fetchedAt: 10_000, elementEpoch: vanguard.EPOCH, provider: 'test', source: 'network', ageMs: 0 }),
    getOrbitalData: async () => ({ elements: [vanguard], fetchedAt: 10_000, elementEpoch: vanguard.EPOCH, provider: 'test', source: 'network', ageMs: 0 }),
    validate: async (_id: number, _at: Date, _observer: unknown, _elements: unknown, _signal: unknown, provider?: string) => { requestedProvider = provider; return []; },
  } as unknown as ApplicationControllerDependencies['data'] });
  const app = createApplicationController(deps);
  await app.initialize();
  await app.selectSatellite(vanguard.NORAD_CAT_ID);
  await app.validateSelected('n2yo');
  assert.equal(requestedProvider, 'n2yo');
  app.dispose();
});

test('preference read failure remains visible without rejecting application initialization', async () => {
  const { deps } = setup({ storage: { getItem: async () => { throw new Error('storage unavailable'); }, setItem: async () => undefined } });
  const app = createApplicationController(deps);
  await assert.doesNotReject(app.initialize());
  assert.match(app.getState().error ?? '', /preferencias/i);
  app.dispose();
});
